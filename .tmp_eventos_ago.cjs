const dotenv=require('dotenv');dotenv.config({path:'.env.local',quiet:true});
const {createClient}=require('@supabase/supabase-js');
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
(async()=>{
 const {data,error}=await sb.from('eventos').select('id,nome,departamento,permite_hospedagem,data_inicio,data_fim').eq('departamento','AGO').eq('permite_hospedagem',true).order('data_inicio',{ascending:false}).limit(5);
 if(error) throw error;
 console.log(JSON.stringify(data,null,2));
})();
