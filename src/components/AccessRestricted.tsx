type AccessRestrictedProps = {
  title?: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export default function AccessRestricted({
  title = 'Acesso restrito',
  message = 'Voce nao tem permissao para acessar esta area.',
  actionLabel,
  onAction,
}: AccessRestrictedProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-4">
      <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
        <span className="text-3xl">🔒</span>
      </div>
      <h2 className="text-xl font-bold text-gray-700 mb-2">{title}</h2>
      <p className="text-gray-500 text-sm max-w-md">{message}</p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="mt-6 bg-[#123b63] text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-[#0f2a45] transition"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
