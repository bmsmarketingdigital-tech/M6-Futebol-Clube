import { getApiContext } from "../../api-auth";
import { deleteManagedLocalUser, updateManagedLocalUser } from "../../local-auth";

const validUsername=(value:string)=>/^[a-z0-9._-]{3,30}$/.test(value);

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
  const context=await getApiContext(request);
  if(!context||context.role!=="admin")return Response.json({error:"Apenas administradores podem alterar usuários."},{status:403});
  const {id}=await params; const body=await request.json() as {displayName?:string;username?:string;password?:string;role?:string};
  const displayName=body.displayName?.trim()??"",username=body.username?.trim().toLowerCase()??"",password=body.password??"",role=body.role==="admin"?"admin":"operator";
  if(displayName.length<3)return Response.json({error:"Informe o nome completo do usuário."},{status:400});
  if(!validUsername(username))return Response.json({error:"Informe um usuário de acesso válido."},{status:400});
  if(password&&password.length<8)return Response.json({error:"A nova senha deve ter pelo menos 8 caracteres."},{status:400});
  if(id===context.user.id&&role!=="admin")return Response.json({error:"Você não pode remover sua própria permissão de administrador."},{status:400});
  try{const user=await updateManagedLocalUser(context.membership.organizationId,id,{displayName,username,role,password:password||undefined});return Response.json({user:{...user,isCurrent:id===context.user.id}});}
  catch(error){const message=error instanceof Error?error.message:"Não foi possível alterar o usuário.";return Response.json({error:message},{status:message==="Usuário não encontrado."?404:400});}
}

export async function DELETE(request:Request,{params}:{params:Promise<{id:string}>}){
  const context=await getApiContext(request);
  if(!context||context.role!=="admin")return Response.json({error:"Apenas administradores podem excluir usuários."},{status:403});
  const {id}=await params;
  try{await deleteManagedLocalUser(context.membership.organizationId,id,context.user.id);return Response.json({deleted:true});}
  catch(error){const message=error instanceof Error?error.message:"Não foi possível excluir o usuário.";return Response.json({error:message},{status:message==="Usuário não encontrado."?404:400});}
}
