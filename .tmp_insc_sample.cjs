const dotenv=require('dotenv');dotenv.config({path:'.env.local',quiet:true});
const {createClient}=require('@supabase/supabase-js');
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
(async()=>{
 const eventoId='8940f4e1-f00b-4115-a4f5-0e912332174c';
 const {data,error}=await sb.from('evento_inscricoes').select('id,nome_inscrito,cpf,supervisao_id,campo_id,sexo,tipo_inscricao,status_pagamento,hospedagem').eq('evento_id',eventoId).limit(3);
 if(error) throw error;
 console.log(JSON.stringify(data,null,2));
})();
