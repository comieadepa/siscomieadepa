/**
 * Google Drive helpers — autenticação via OAuth 2.0 (Client ID + Refresh Token)
 * Credenciais: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN
 * Pasta raiz:  GOOGLE_DRIVE_ROOT_FOLDER_ID
 *
 * Setup inicial: acesse /api/auth/google/drive/setup para autorizar uma vez.
 * Após autorizar, salve o refresh_token em GOOGLE_DRIVE_REFRESH_TOKEN.
 */

import { google } from 'googleapis';
import type { drive_v3 } from 'googleapis';
import { Readable } from 'stream';
import { buildUrl, getAppBaseUrl } from '@/lib/urls';

export type DocumentoEntidadeTipo = 'ministro' | 'candidato_consagracao';

type UploadDocumentoDriveInput = {
  entidadeTipo: DocumentoEntidadeTipo;
  entidadeId: string;
  entidadeNome: string;
  tipoDocumento?: string;
  fileName: string;
  mimeType: string;
  fileBuffer: Buffer;
  matricula?: string;
  ano?: string;
};

function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID ou GOOGLE_CLIENT_SECRET não configurados.');
  }
  if (!refreshToken) {
    throw new Error('GOOGLE_DRIVE_REFRESH_TOKEN não configurado. Acesse /api/auth/google/drive/setup para autorizar.');
  }

  const oauth2 = new google.auth.OAuth2(
    clientId,
    clientSecret,
    buildUrl(getAppBaseUrl(), '/api/auth/google/drive/callback'),
  );

  oauth2.setCredentials({ refresh_token: refreshToken });
  return oauth2;
}

function getDriveClient(): drive_v3.Drive {
  return google.drive({ version: 'v3', auth: getOAuth2Client() });
}

export function getOAuth2ClientForSetup() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID ou GOOGLE_CLIENT_SECRET não configurados.');
  }

  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    buildUrl(getAppBaseUrl(), '/api/auth/google/drive/callback'),
  );
}

const ROOT_FOLDER_ID = () => {
  const id = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!id) throw new Error('GOOGLE_DRIVE_ROOT_FOLDER_ID não configurado.');
  return id;
};

function sanitizeFolderName(value: string): string {
  return String(value || '')
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function getOrCreateFolder(parentId: string, folderName: string): Promise<string> {
  const drive = getDriveClient();
  const safeName = sanitizeFolderName(folderName);
  const res = await drive.files.list({
    q: `name = '${safeName.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    spaces: 'drive',
  });

  if (res.data.files && res.data.files.length > 0) {
    return res.data.files[0].id!;
  }

  const folder = await drive.files.create({
    requestBody: {
      name: safeName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
  });

  return folder.data.id!;
}

async function getOrCreateConsagracaoCandidateFolder(input: {
  candidatoId: string;
  candidatoNome: string;
  ano?: string;
}): Promise<string> {
  const rootId = ROOT_FOLDER_ID();
  const year = String(input.ano || new Date().getFullYear());
  const consagracoesId = await getOrCreateFolder(rootId, 'Consagracoes');
  const yearId = await getOrCreateFolder(consagracoesId, year);
  const candidatoFolder = `${sanitizeFolderName(input.candidatoNome) || 'CANDIDATO'} - ${input.candidatoId}`;
  return getOrCreateFolder(yearId, candidatoFolder);
}

/** Retorna o ID da subpasta do ministro, criando se não existir */
export async function getOrCreateMemberFolder(
  memberId: string,
  memberName: string,
  matricula: string,
): Promise<string> {
  const rootId = ROOT_FOLDER_ID();
  const folderName = `${matricula || memberId}_${sanitizeFolderName(memberName)}`;
  return getOrCreateFolder(rootId, folderName);
}

/** Lista todos os arquivos na subpasta do ministro */
export async function listMemberFiles(
  memberId: string,
  memberName: string,
  matricula: string,
): Promise<drive_v3.Schema$File[]> {
  const drive = getDriveClient();
  const folderId = await getOrCreateMemberFolder(memberId, memberName, matricula);

  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType, size, createdTime, webViewLink, webContentLink)',
    orderBy: 'createdTime desc',
    spaces: 'drive',
  });

  return res.data.files || [];
}

/** Faz upload de um arquivo para a subpasta do ministro */
export async function uploadFileToDrive(
  folderId: string,
  fileName: string,
  mimeType: string,
  fileBuffer: Buffer,
): Promise<drive_v3.Schema$File> {
  const drive = getDriveClient();
  const stream = Readable.from(fileBuffer);

  const res = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: stream },
    fields: 'id, name, webViewLink, webContentLink, mimeType, size, createdTime',
  });

  return res.data;
}

export async function uploadDocumentoDrive(input: UploadDocumentoDriveInput): Promise<drive_v3.Schema$File> {
  const tipoPrefixo = input.tipoDocumento ? `[${input.tipoDocumento}] ` : '';
  const nomeArquivo = `${tipoPrefixo}${input.fileName}`;

  let folderId: string;
  if (input.entidadeTipo === 'candidato_consagracao') {
    folderId = await getOrCreateConsagracaoCandidateFolder({
      candidatoId: input.entidadeId,
      candidatoNome: input.entidadeNome,
      ano: input.ano,
    });
  } else {
    folderId = await getOrCreateMemberFolder(
      input.entidadeId,
      input.entidadeNome,
      input.matricula || '',
    );
  }

  return uploadFileToDrive(folderId, nomeArquivo, input.mimeType, input.fileBuffer);
}

/** Deleta um arquivo do Drive */
export async function deleteFileFromDrive(fileId: string): Promise<void> {
  const drive = getDriveClient();
  await drive.files.delete({ fileId });
}

/**
 * Retorna o stream do arquivo + metadados para proxy de visualização.
 * Não armazena nada — passa o conteúdo do Drive direto para o Response.
 */
export async function getDriveStream(
  fileId: string,
): Promise<{ stream: NodeJS.ReadableStream; mimeType: string; fileName: string }> {
  const drive = getDriveClient();

  // busca metadados
  const meta = await drive.files.get({ fileId, fields: 'name,mimeType' });
  const mimeType = meta.data.mimeType || 'application/octet-stream';
  const fileName = meta.data.name || fileId;

  // stream do conteúdo
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' },
  );

  return { stream: res.data as unknown as NodeJS.ReadableStream, mimeType, fileName };
}

/** Lista os arquivos no Drive de acordo com o tipo da entidade (membro/ministro ou candidato) */
export async function listDocumentosDrive(
  entidadeTipo: DocumentoEntidadeTipo,
  entidadeId: string,
  entidadeNome: string,
  matricula?: string,
  ano?: string,
): Promise<drive_v3.Schema$File[]> {
  const drive = getDriveClient();
  let folderId: string;
  if (entidadeTipo === 'candidato_consagracao') {
    folderId = await getOrCreateConsagracaoCandidateFolder({
      candidatoId: entidadeId,
      candidatoNome: entidadeNome,
      ano,
    });
  } else {
    folderId = await getOrCreateMemberFolder(entidadeId, entidadeNome, matricula || '');
  }

  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType, size, createdTime, webViewLink, webContentLink)',
    orderBy: 'createdTime desc',
    spaces: 'drive',
  });

  return res.data.files || [];
}

export async function initiateResumableUpload(input: {
  entidadeTipo: DocumentoEntidadeTipo;
  entidadeId: string;
  entidadeNome: string;
  tipoDocumento?: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  matricula?: string;
  ano?: string;
}): Promise<{ uploadUrl: string; folderId: string; fileName: string }> {
  const tipoPrefixo = input.tipoDocumento ? `[${input.tipoDocumento}] ` : '';
  const nomeArquivo = `${tipoPrefixo}${input.fileName}`;

  let folderId: string;
  if (input.entidadeTipo === 'candidato_consagracao') {
    folderId = await getOrCreateConsagracaoCandidateFolder({
      candidatoId: input.entidadeId,
      candidatoNome: input.entidadeNome,
      ano: input.ano,
    });
  } else {
    folderId = await getOrCreateMemberFolder(
      input.entidadeId,
      input.entidadeNome,
      input.matricula || '',
    );
  }

  const oauth2 = getOAuth2Client();
  const credentials = await oauth2.getAccessToken();
  const token = credentials.token;
  if (!token) {
    throw new Error('Falha ao obter token de acesso do Google Drive.');
  }

  // Chamar o endpoint da Google para iniciar upload resumable
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': input.mimeType,
      'X-Upload-Content-Length': String(input.fileSize),
    },
    body: JSON.stringify({
      name: nomeArquivo,
      parents: [folderId],
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Erro da API do Google Drive ao iniciar upload resumível: ${res.status} - ${errorText}`);
  }

  const uploadUrl = res.headers.get('Location');
  if (!uploadUrl) {
    throw new Error('A API do Google Drive não retornou o cabeçalho Location para o upload resumível.');
  }

  return { uploadUrl, folderId, fileName: nomeArquivo };
}
