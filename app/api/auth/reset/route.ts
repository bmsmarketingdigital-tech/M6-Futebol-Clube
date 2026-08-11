import { getApiContext } from "../../api-auth";
import { resetLocalPassword } from "../../local-auth";

export async function POST(request:Request){
  const context=await getApiContext(request);
  if(!context||context.role!=="admin")return Response.json({error:"Apenas um administrador autenticado pode redefinir senhas."},{status:403});
  const body=await request.json() as {username?:string;password?:string};
  const username=body.username?.trim()??"",password=body.password??"";
  if(username.length<3)return Response.json({error:"Informe o usuário de acesso."},{status:400});
  if(password.length<8)return Response.json({error:"A nova senha deve ter pelo menos 8 caracteres."},{status:400});
  try{await resetLocalPassword(context.membership.organizationId,username,password);return Response.json({ok:true});}
  catch(error){const message=error instanceof Error?error.message:"Não foi possível redefinir a senha.";return Response.json({error:message},{status:message==="Usuário não encontrado."?404:400});}
}
