import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireModuleAccess } from '@/lib/auth/require-auth';

export async function GET(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'secretaria');
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const includeInactive = searchParams.get('includeInactive') === 'true';
  const id = searchParams.get('id');

  const supabase = createServerClient();

  // Busca contatos de members com paginação para enriquecer
  let membersData: any[] = [];
  let mFrom = 0;
  const mLimit = 1000;
  let mHasMore = true;
  while (mHasMore) {
    const { data: mData, error: mErr } = await supabase
      .from('members')
      .select('cpf, celular, whatsapp, phone')
      .range(mFrom, mFrom + mLimit - 1);
    if (mErr || !mData || mData.length === 0) {
      mHasMore = false;
    } else {
      membersData = [...membersData, ...mData];
      if (mData.length < mLimit) {
        mHasMore = false;
      } else {
        mFrom += mLimit;
      }
    }
  }
  
  const memberContactMap = new Map();
  if (membersData.length > 0) {
    membersData.forEach((m: any) => {
      if (m.cpf) {
        const contact = m.whatsapp || m.celular || m.phone || '';
        memberContactMap.set(m.cpf.replace(/\D/g, ''), contact);
      }
    });
  }

  if (id) {
    const { data, error } = await supabase
      .from('campos')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const enrichedSingle = data ? {
      ...data,
      presidente_contato: memberContactMap.get((data.presidente_cpf || '').replace(/\D/g, '')) || data.telefone || null
    } : null;

    return NextResponse.json({ data: enrichedSingle });
  }

  let allData: any[] = [];
  let from = 0;
  const limit = 1000;
  let hasMore = true;

  while (hasMore) {
    let q = supabase.from('campos').select('*').order('nome').range(from, from + limit - 1);
    if (!includeInactive) {
      q = q.neq('is_active', false);
    }
    const { data, error } = await q;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      allData = [...allData, ...data];
      if (data.length < limit) {
        hasMore = false;
      } else {
        from += limit;
      }
    }
  }

  const enrichedData = allData.map(c => {
    const cpfLimpo = (c.presidente_cpf || '').replace(/\D/g, '');
    return {
      ...c,
      presidente_contato: memberContactMap.get(cpfLimpo) || c.telefone || null
    };
  });

  return NextResponse.json({ data: enrichedData });
}

export async function POST(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'secretaria');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null as any);
  if (!body) {
    return NextResponse.json({ error: 'Payload invalido.' }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data, error } = await supabase.from('campos').insert([body]).select('*').maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'secretaria');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null as any);
  const id = body?.id as string | undefined;
  if (!id) {
    return NextResponse.json({ error: 'Id invalido.' }, { status: 400 });
  }

  const updates = { ...body } as Record<string, any>;
  delete updates.id;

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('campos')
    .update(updates)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'secretaria');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null as any);
  const id = body?.id as string | undefined;
  if (!id) {
    return NextResponse.json({ error: 'Id invalido.' }, { status: 400 });
  }

  const supabase = createServerClient();
  const { error } = await supabase.from('campos').delete().eq('id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
