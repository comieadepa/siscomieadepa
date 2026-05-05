import csv
from collections import Counter

with open(r'C:\BACKUP\DESENVOLVIMENTO\supervisao_ok.csv', encoding='utf-8-sig') as f:
    reader = csv.reader(f, delimiter=';')
    headers = next(reader)
    rows = list(reader)

print('Headers:', headers)
print(f'Total linhas: {len(rows)}')

nome_idx = headers.index('NOME DA SUPERVISÃO')
mat_idx  = headers.index('MATRICULA SUPERVISOR')

nomes = [r[nome_idx].strip() for r in rows]
mats  = [r[mat_idx].strip() for r in rows if r[mat_idx].strip()]

dup_nomes = {n: c for n, c in Counter(nomes).items() if c > 1}
dup_mats  = {m: c for m, c in Counter(mats).items()  if c > 1}

print(f'\n=== NOMES DUPLICADOS ({len(dup_nomes)}) ===')
for n, c in dup_nomes.items():
    linhas = [i+2 for i, r in enumerate(rows) if r[nome_idx].strip() == n]
    print(f'  {c}x "{n}" -> linhas {linhas}')
    for li in linhas:
        r = rows[li-2]
        print(f'    L{li}: mat={r[mat_idx]} | pastor={r[headers.index("PASTOR SUPERVISOR")] if "PASTOR SUPERVISOR" in headers else "?"}')

print(f'\n=== MATRICULAS DUPLICADAS ({len(dup_mats)}) ===')
for m, c in dup_mats.items():
    linhas = [i+2 for i, r in enumerate(rows) if r[mat_idx].strip() == m]
    print(f'  {c}x matricula={m} -> linhas {linhas}')
    for li in linhas:
        print(f'    L{li}: nome="{rows[li-2][nome_idx]}"')
