console.log('--- ENV KEYS CONTAINING SUPABASE/NEXT_PUBLIC ---');
Object.keys(process.env).forEach(key => {
  if (key.includes('SUPABASE') || key.includes('NEXT_PUBLIC')) {
    console.log(`${key}: ${process.env[key] ? 'SET (length ' + process.env[key].length + ')' : 'EMPTY'}`);
  }
});
