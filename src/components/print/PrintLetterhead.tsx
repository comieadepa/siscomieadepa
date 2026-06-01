type PrintLetterheadProps = {
  reportTitle: string;
  eventName?: string | null;
  periodText?: string | null;
  locationText?: string | null;
  issuedAtText?: string | null;
  totalRecords?: number | null;
  filtersText?: string | null;
  className?: string;
};

export default function PrintLetterhead({
  reportTitle,
  eventName,
  periodText,
  locationText,
  issuedAtText,
  totalRecords,
  filtersText,
  className,
}: PrintLetterheadProps) {
  return (
    <>
      <header className={`print-letterhead-wrap ${className ?? ''}`}>
        <div className="print-letterhead">
          <img
            src="/img/logo_comieadepa.png"
            alt="Logo COMIEADEPA"
            className="print-logo"
          />
          <div className="print-org">
            <p className="print-org-name">COMIEADEPA</p>
            <p>Convenção Interestadual de Ministros e Igrejas Evangélicas Assembleia de Deus no Estado do Pará</p>
            <p>Rodovia Mário Covas, 2500, Coqueiro, Belém, PA</p>
            <p>CNPJ: 04.760.047/0001-04 • Contato: contato@comieadepa.org</p>
          </div>
        </div>

        <div className="print-divider" />

        <div className="print-report-title">{reportTitle}</div>

        <div className="print-report-meta">
          {eventName && <span><strong>Evento:</strong> {eventName}</span>}
          {periodText && <span><strong>Período:</strong> {periodText}</span>}
          {locationText && <span><strong>Cidade/local:</strong> {locationText}</span>}
          {issuedAtText && <span><strong>Data de emissão:</strong> {issuedAtText}</span>}
          {typeof totalRecords === 'number' && <span><strong>Total de registros:</strong> {totalRecords}</span>}
        </div>

        {filtersText ? (
          <p className="print-report-filters">Filtros: {filtersText}</p>
        ) : null}
      </header>

      <style jsx global>{`
        .print-letterhead-wrap {
          margin-bottom: 12px;
        }
        .print-letterhead {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .print-logo {
          width: 70px;
          height: auto;
          object-fit: contain;
          flex-shrink: 0;
        }
        .print-org {
          min-width: 0;
        }
        .print-org p {
          margin: 0;
          line-height: 1.35;
          font-size: 11px;
          color: #374151;
          word-break: break-word;
        }
        .print-org-name {
          font-size: 18px !important;
          font-weight: 800;
          color: #0d2b4e !important;
          letter-spacing: 0.02em;
          margin-bottom: 2px !important;
        }
        .print-divider {
          border-bottom: 2px solid #14b8a6;
          margin-top: 8px;
        }
        .print-report-title {
          text-align: center;
          font-size: 14px;
          font-weight: 700;
          margin: 10px 0 6px;
          color: #0d2b4e;
        }
        .print-report-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 6px 14px;
          justify-content: center;
          font-size: 11px;
          color: #4b5563;
          margin-bottom: 6px;
        }
        .print-report-filters {
          margin: 0 0 10px;
          font-size: 10px;
          text-align: center;
          color: #6b7280;
        }
      `}</style>
    </>
  );
}
