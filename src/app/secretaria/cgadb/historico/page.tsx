import { redirect } from 'next/navigation';

export default function CgadbHistoricoRedirect() {
  redirect('/secretaria/cgadb/debitos?tab=debitos');
}
