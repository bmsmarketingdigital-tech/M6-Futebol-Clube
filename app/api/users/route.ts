import { getApiContext } from "../api-auth";
import { createManagedLocalUser, listManagedLocalUsers } from "../local-auth";

export const dynamic = "force-dynamic";
const validUsername = (value:string) => /^[a-z0-9._-]{3,30}$/.test(value);

export async function GET(request:Request){
  try {
    const context=await getApiContext(request);
    if(!context||context.role!=="admin")return Response.json({error:"Apenas administradores podem gerenciar usuários."},{status:403});
    const users=await listManagedLocalUsers(context.membership.organizationId);
    return Response.json({users:users.map(user=>({...user,isCurrent:user.id===context.user.id}))});
  } catch (error) {
    console.error("Failed to list managed users", error);
    return Response.json({error:"Não foi possível carregar os usuários."},{status:500});
  }
}

export async function POST(request:Request){
  const context=await getApiContext(request);
  if(!context||context.role!=="admin")return Response.json({error:"Apenas administradores podem criar usuários."},{status:403});
  const body=await request.json() as {displayName?:string;username?:string;password?:string;role?:string};
  const displayName=body.displayName?.trim()??"",username=body.username?.trim().toLowerCase()??"",password=body.password??"",role=body.role==="admin"?"admin":"operator";
  if(displayName.length<3)return Response.json({error:"Informe o nome completo do usuário."},{status:400});
  if(!validUsername(username))return Response.json({error:"Use de 3 a 30 letras, números, ponto, traço ou sublinhado no usuário."},{status:400});
  if(password.length<8)return Response.json({error:"A senha deve ter pelo menos 8 caracteres."},{status:400});
  try{const user=await createManagedLocalUser(context.membership.organizationId,{displayName,username,password,role});return Response.json({user:{...user,isCurrent:false}},{status:201});}
  catch(error){return Response.json({error:error instanceof Error?error.message:"Não foi possível criar o usuário."},{status:400});}
}
