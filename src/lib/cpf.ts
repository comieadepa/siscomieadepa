export function cleanCpf(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '');
}

/** Formata string de 11 dígitos para 000.000.000-00 se possível */
export function formatCpf(value: string | null | undefined): string {
  const digits = cleanCpf(value);
  if (digits.length !== 11) return digits;
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

/**
 * Retorna true se o CPF armazenado (com ou sem pontuação) corresponde ao termo de busca.
 * Trata buscas parciais e completas com ou sem pontuação (ex: '012.345', '012345', '345-67').
 */
export function matchCpf(storedCpf: string | null | undefined, searchTerm: string | null | undefined): boolean {
  if (!storedCpf || !searchTerm) return false;
  const sRaw = String(storedCpf).trim();
  const qRaw = String(searchTerm).trim();
  if (!sRaw || !qRaw) return false;

  // Comparação direta textual
  if (sRaw.toLowerCase().includes(qRaw.toLowerCase())) return true;

  // Comparação normalizada apenas dígitos (elimina pontuações e formatações de ambos)
  const sDigits = sRaw.replace(/\D/g, '');
  const qDigits = qRaw.replace(/\D/g, '');
  if (qDigits && sDigits && sDigits.includes(qDigits)) return true;

  // Se storedCpf estava em dígitos puros e searchTerm está formatado (ou vice-versa)
  const sFormatted = formatCpf(sDigits);
  if (sFormatted && sFormatted.includes(qRaw)) return true;

  return false;
}

/**
 * Constrói lista de variantes de busca para filtros de banco (ex: ilike ou or no Supabase)
 * Retorna tanto a versão crua/parcial de dígitos quanto o termo original.
 */
export function getCpfSearchVariants(term: string | null | undefined): string[] {
  if (!term) return [];
  const raw = term.trim();
  const digits = raw.replace(/\D/g, '');
  const variants = new Set<string>();

  if (raw) variants.add(raw);
  if (digits) {
    variants.add(digits);
    if (digits.length === 11) {
      variants.add(formatCpf(digits));
    }
  }

  return Array.from(variants);
}

export function isValidCpf(value: string | null | undefined): boolean {
  const cpf = cleanCpf(value);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    sum += Number(cpf[i]) * (10 - i);
  }
  let digit = (sum * 10) % 11;
  if (digit === 10) digit = 0;
  if (digit !== Number(cpf[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i += 1) {
    sum += Number(cpf[i]) * (11 - i);
  }
  digit = (sum * 10) % 11;
  if (digit === 10) digit = 0;

  return digit === Number(cpf[10]);
}
