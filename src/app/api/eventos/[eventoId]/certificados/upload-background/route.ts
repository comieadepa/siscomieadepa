import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';

// POST /api/eventos/[eventoId]/certificados/upload-background
// Faz upload da imagem de fundo do certificado para o Supabase Storage
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;

  // Auth
  const guard = await requireEventoPermission(req, eventoId, 'configuracoes');
  if (!guard.ok) return guard.response;

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'Arquivo não enviado.' }, { status: 400 });

  // Valida tipo
  const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json({ error: 'Tipo de arquivo não suportado. Use PNG, JPG ou WebP.' }, { status: 400 });
  }

  // Valida tamanho (máx 5MB)
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'Arquivo muito grande. Máximo 5MB.' }, { status: 400 });
  }

  const supabase = guard.ctx.supabaseAdmin;

  const ext = file.name.split('.').pop() ?? 'jpg';
  const path = `${eventoId}/background.${ext}`;
  const bytes = await file.arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from('cert-backgrounds')
    .upload(path, bytes, { contentType: file.type, upsert: true });

  if (uploadError) {
    return NextResponse.json({ error: 'Erro ao fazer upload: ' + uploadError.message }, { status: 500 });
  }

  const { data: { publicUrl } } = supabase.storage
    .from('cert-backgrounds')
    .getPublicUrl(path);

  // Salva a URL na configuração do evento
  await supabase
    .from('evento_certificado_config')
    .upsert(
      { evento_id: eventoId, background_url: publicUrl, updated_at: new Date().toISOString() },
      { onConflict: 'evento_id' }
    );

  return NextResponse.json({ url: publicUrl });
}
