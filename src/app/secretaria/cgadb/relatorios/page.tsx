import { redirect } from 'next/navigation';

export default function CgadbRelatoriosRedirect() {
  redirect('/secretaria/cgadb/debitos?tab=ministros');
}
