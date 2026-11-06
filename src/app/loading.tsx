import LoadingTransition from '@/components/LoadingTransition';

export default function Loading() {
  return <LoadingTransition mensagem="Carregando módulo..." subtitulo="SISCOMIEADEPA" fullScreen={true} />;
}
