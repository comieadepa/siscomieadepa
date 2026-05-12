type UppercaseOptions = {
  forceFields?: string[];
  ignoreFields?: string[];
};

const ALLOW_TOKENS = [
  'nome',
  'descricao',
  'observacao',
  'mensagem',
  'cidade',
  'estado',
  'departamento',
  'local',
  'setor',
  'supervisao',
  'campo',
  'publico',
  'titulo',
  'programacao',
  'palestrante',
  'cargo',
  'equipe',
  'etiqueta',
  'certificado',
  'cupom',
  'responsavel',
  'tipo_inscricao',
];

const DENY_TOKENS = [
  'email',
  'senha',
  'password',
  'token',
  'url',
  'link',
  'pix',
  'qr',
  'base64',
  'chave',
  'hash',
  'id',
  'slug',
  'dominio',
  'domain',
  'arquivo',
  'imagem',
  'image',
  'file',
  'path',
  'json',
  'html',
  'markdown',
  'md',
  'cpf',
  'cnpj',
  'telefone',
  'whatsapp',
  'celular',
  'codigo',
  'status',
  'pagamento',
  'checkin',
  'sexo',
];

export function normalizeUppercase(value: string): string {
  return value.toUpperCase();
}

export function shouldUppercaseField(fieldName: string, options?: UppercaseOptions): boolean {
  const key = fieldName.toLowerCase();
  if (options?.ignoreFields?.some(f => f.toLowerCase() === key)) return false;
  if (DENY_TOKENS.some(token => key.includes(token))) return false;
  if (options?.forceFields?.some(f => f.toLowerCase() === key)) return true;
  return ALLOW_TOKENS.some(token => key.includes(token));
}

export function normalizePayloadUppercase<T extends Record<string, unknown>>(
  payload: T,
  options?: UppercaseOptions
): T {
  const out = { ...payload } as Record<string, unknown>;
  Object.keys(out).forEach(key => {
    const value = out[key];
    if (typeof value === 'string' && shouldUppercaseField(key, options)) {
      out[key] = normalizeUppercase(value);
    }
  });
  return out as T;
}
