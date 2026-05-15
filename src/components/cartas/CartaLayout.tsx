'use client';

type CartaLayoutProps = {
  numero: string;
  titulo: string;
  dataEmissao: string;
  cidadeUf: string;
  presidente: string;
  texto: string;
  validade?: string;
  observacoes?: string | null;
};

const fmtDate = (value?: string | null) => {
  if (!value) return '';
  const dt = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleDateString('pt-BR');
};

export default function CartaLayout({
  numero,
  titulo,
  dataEmissao,
  cidadeUf,
  presidente,
  texto,
  validade,
  observacoes,
}: CartaLayoutProps) {
  const paragrafos = texto.split('\n\n').filter(Boolean);

  const renderUnderline = (value: string, keyPrefix: string) => {
    const parts = value.split('__');
    if (parts.length === 1) return value;
    return parts.map((part, index) => {
      if (index % 2 === 1) {
        return <u key={`${keyPrefix}-u-${index}`}>{part}</u>;
      }
      return <span key={`${keyPrefix}-t-${index}`}>{part}</span>;
    });
  };

  const renderInline = (value: string, keyPrefix: string) => {
    const parts = value.split('**');
    if (parts.length === 1) return renderUnderline(value, keyPrefix);
    return parts.map((part, index) => {
      const content = renderUnderline(part, `${keyPrefix}-u-${index}`);
      if (index % 2 === 1) {
        return <strong key={`${keyPrefix}-b-${index}`}>{content}</strong>;
      }
      return <span key={`${keyPrefix}-t-${index}`}>{content}</span>;
    });
  };

  const renderParagraph = (raw: string, index: number) => {
    const isRight = raw.startsWith('[[right]]');
    const content = isRight ? raw.replace('[[right]]', '').trim() : raw;
    const lines = content.split('\n');
    return (
      <p
        key={`p-${index}`}
        style={{
          marginBottom: '14px',
          textAlign: isRight ? 'right' : 'justify',
        }}
      >
        {lines.map((line, lineIndex) => (
          <span key={`p-${index}-l-${lineIndex}`}>
            {renderInline(line, `p-${index}-l-${lineIndex}`)}
            {lineIndex < lines.length - 1 ? <br /> : null}
          </span>
        ))}
      </p>
    );
  };

  return (
    <div
      className="carta-layout"
      style={{
        width: '210mm',
        minHeight: '297mm',
        margin: '0 auto',
        padding: '18mm 18mm 30mm',
        fontFamily: 'Arial, sans-serif',
        fontSize: '12px',
        lineHeight: '1.6',
        color: '#1f2937',
        backgroundColor: '#ffffff',
        boxSizing: 'border-box',
        position: 'relative',
        overflow: 'visible',
      }}
    >
      <style>{`
        @media print {
          .carta-layout {
            overflow: visible;
            page-break-inside: avoid;
          }
          .carta-footer {
            position: fixed;
            left: 0;
            right: 0;
            bottom: 0;
          }
        }
      `}</style>
      <div
        style={{
          minHeight: '140px',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#6b3f1f',
          borderRadius: '8px 8px 0 0',
          padding: '6px 10px',
        }}
      >
        <img
          src="/img/timbre-cartas-topo.jpg"
          alt="Timbre superior"
          style={{
            width: '100%',
            height: '100%',
            maxHeight: '140px',
            objectFit: 'contain',
            objectPosition: 'center top',
            display: 'block',
          }}
        />
      </div>
      <div style={{ height: '4px', backgroundColor: '#d4af37', marginTop: '4px' }} />

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '14px' }}>
        <div style={{ textAlign: 'right', fontSize: '10px', color: '#374151' }}>
          <div style={{ fontWeight: 'bold' }}>Nº {numero}</div>
          <div>{cidadeUf}, {fmtDate(dataEmissao)}</div>
        </div>
      </div>

      <div
        style={{
          marginTop: '18px',
          padding: '8px 10px',
          textAlign: 'center',
          fontWeight: 'bold',
          letterSpacing: '2px',
          background: '#0D2B4E',
          color: '#F39C12',
          borderBottom: '3px solid #d4af37',
        }}
      >
        {titulo}
      </div>

      <div style={{ marginTop: '18px' }}>
        {paragrafos.map((p, idx) => renderParagraph(p, idx))}
      </div>

      {validade && (
        <div
          style={{
            marginTop: '16px',
            padding: '8px',
            border: '1px dashed #9ca3af',
            textAlign: 'center',
            fontSize: '10px',
            color: '#6b7280',
          }}
        >
          Validade: {validade}
        </div>
      )}

      {observacoes && (
        <div
          style={{
            marginTop: '16px',
            padding: '10px',
            borderLeft: '3px solid #d4af37',
            backgroundColor: '#f8fafc',
            fontSize: '10px',
            color: '#6b7280',
          }}
        >
          Observacoes internas: {observacoes}
        </div>
      )}

      <div style={{ marginTop: '104px', textAlign: 'center' }}>
        <div style={{ width: '60%', margin: '0 auto', borderTop: '1px solid #111827', paddingTop: '6px' }}>
          <div style={{ fontWeight: 'bold', fontSize: '11px' }}>{presidente}</div>
          <div style={{ fontSize: '10px', color: '#6b7280' }}>Presidente</div>
        </div>
      </div>

      <div className="carta-footer" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '0 18mm 12mm' }}>
        <div style={{ height: '4px', backgroundColor: '#d4af37', marginBottom: '4px' }} />
        <div
          style={{
            minHeight: '90px',
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#6b3f1f',
            padding: '6px 10px',
          }}
        >
          <img
            src="/img/timbre-cartas-rodape.jpg"
            alt="Timbre inferior"
            style={{
              width: '100%',
              height: '100%',
              maxHeight: '90px',
              objectFit: 'contain',
              objectPosition: 'center bottom',
              display: 'block',
            }}
          />
        </div>
      </div>
    </div>
  );
}
