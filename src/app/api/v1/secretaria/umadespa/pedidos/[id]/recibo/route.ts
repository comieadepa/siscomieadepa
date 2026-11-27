import { NextRequest, NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/auth/require-auth';
import { obterDadosReciboUmadespa } from '@/lib/umadespa/recibo-service';
import { gerarReciboUmadespaPdf } from '@/lib/umadespa/recibo-pdf';
import { logDB } from '@/lib/audit';

/**
 * GET /api/v1/secretaria/umadespa/pedidos/[id]/recibo
 * Emissão sob demanda do Recibo Oficial UMADESPA em PDF.
 * Apenas para solicitações com pagamento confirmado.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModuleAccess(request, 'umadespa');
    if (!auth.ok) return auth.response;

    const { id: solicitacaoId } = await params;
    if (!solicitacaoId) {
      return NextResponse.json({ error: 'ID da solicitação não informado.' }, { status: 400 });
    }

    const { ok, dados, erro, codigoHttp } = await obterDadosReciboUmadespa(solicitacaoId);
    if (!ok || !dados) {
      return NextResponse.json({ error: erro || 'Erro ao obter dados do recibo.' }, { status: codigoHttp || 400 });
    }

    const { base64, filename } = await gerarReciboUmadespaPdf(dados);
    const pdfBuffer = Buffer.from(base64, 'base64');

    void logDB({
      acao: 'gerar_recibo_pdf',
      modulo: 'secretaria',
      entidade: 'umadespa_recibo',
      entidadeId: solicitacaoId,
      descricao: `Recibo oficial UMADESPA (${dados.numeroRecibo}) visualizado/baixado por ${auth.ctx.user.email}`,
      status: 'sucesso',
      detalhes: {
        solicitacaoId,
        numeroRecibo: dados.numeroRecibo,
        operadorEmail: auth.ctx.user.email,
      },
    });

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: any) {
    console.error('[UMADESPA RECIBO GET ROUTE] Erro:', err);
    return NextResponse.json({ error: 'Erro ao gerar recibo em PDF.' }, { status: 500 });
  }
}
