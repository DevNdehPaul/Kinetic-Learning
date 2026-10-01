import { Router } from "express";
import prisma from "../../lib/prisma.js";
import { requireAuth, type AuthenticatedRequest } from "../../middlewares/auth.middleware.js";
import { getLlmProvider, type TutorTurn } from "./llm.provider.js";

const router = Router();
const param = (v: string | string[] | undefined) => Array.isArray(v) ? v[0] : v;
router.use(requireAuth);

async function ownsSession(id: string, userId: string) {
  return prisma.tutorSession.findFirst({ where: { id, userId } });
}
async function activeProgram(userId: string, programId: string) {
  return prisma.enrollment.findFirst({ where: { userId, programId, status: "ACTIVE" }, select: { id: true } });
}

router.post("/sessions", async (req: AuthenticatedRequest, res) => {
  const { programId, courseId, moduleId, chapterId, title } = req.body ?? {};
  if (!programId && !courseId && !moduleId && !chapterId) return res.status(400).json({ success:false, message:"At least one learning context ID is required" });
  let resolvedProgramId = typeof programId === "string" ? programId : undefined;
  if (chapterId) { const x=await prisma.chapter.findUnique({where:{id:chapterId},select:{module:{select:{course:{select:{programId:true}}}}}}); resolvedProgramId=x?.module.course.programId; }
  else if (moduleId) { const x=await prisma.module.findUnique({where:{id:moduleId},select:{course:{select:{programId:true}}}}); resolvedProgramId=x?.course.programId; }
  else if (courseId) { const x=await prisma.course.findUnique({where:{id:courseId},select:{programId:true}}); resolvedProgramId=x?.programId; }
  if (!resolvedProgramId) return res.status(404).json({success:false,message:"Learning context not found"});
  if (!await activeProgram(req.userId!, resolvedProgramId)) return res.status(403).json({success:false,message:"Active program enrollment required"});
  const session=await prisma.tutorSession.create({data:{userId:req.userId!,programId:resolvedProgramId,courseId:typeof courseId==="string"?courseId:null,moduleId:typeof moduleId==="string"?moduleId:null,chapterId:typeof chapterId==="string"?chapterId:null,title:typeof title==="string"?title.trim()||null:null}});
  return res.status(201).json({success:true,data:{session}});
});

router.get("/sessions", async (req:AuthenticatedRequest,res)=>{
  const sessions=await prisma.tutorSession.findMany({where:{userId:req.userId!},orderBy:{updatedAt:"desc"},include:{_count:{select:{messages:true}},program:{select:{id:true,title:true}},chapter:{select:{id:true,title:true}}}});
  res.json({success:true,data:{sessions}});
});

router.get("/sessions/:id/messages", async (req:AuthenticatedRequest,res)=>{
  const id=param(req.params.id); if(!id) return res.status(400).json({success:false,message:"Session ID is required"});
  if(!await ownsSession(id,req.userId!)) return res.status(404).json({success:false,message:"Tutor session not found"});
  const messages=await prisma.tutorMessage.findMany({where:{sessionId:id},orderBy:{createdAt:"asc"}});
  res.json({success:true,data:{messages}});
});

router.post("/sessions/:id/messages", async (req:AuthenticatedRequest,res)=>{
  const id=param(req.params.id), content=req.body?.content;
  if(!id) return res.status(400).json({success:false,message:"Session ID is required"});
  if(typeof content!=="string"||!content.trim()) return res.status(400).json({success:false,message:"Message content is required"});
  const session=await prisma.tutorSession.findFirst({where:{id,userId:req.userId!},include:{program:{select:{title:true}},course:{select:{title:true}},module:{select:{title:true}},chapter:{select:{title:true,content:true}}}});
  if(!session) return res.status(404).json({success:false,message:"Tutor session not found"});
  await prisma.tutorMessage.create({data:{sessionId:id,role:"USER",content:content.trim()}});
  const history=await prisma.tutorMessage.findMany({where:{sessionId:id},orderBy:{createdAt:"asc"},take:30});
  const context=`You are Kinetic Learning's AI tutor. Teach clearly, guide rather than merely give answers, and stay within the learner's context. Program: ${session.program?.title??"N/A"}; Course: ${session.course?.title??"N/A"}; Module: ${session.module?.title??"N/A"}; Chapter: ${session.chapter?.title??"N/A"}. Chapter material: ${session.chapter?.content?.slice(0,12000)??"Not provided"}`;
  const turns:TutorTurn[]=[{role:"system",content:context},...history.map(m=>({role:m.role==="USER"?"user" as const:m.role==="ASSISTANT"?"assistant" as const:"system" as const,content:m.content}))];
  try {
    const answer=await getLlmProvider().complete(turns);
    const saved=await prisma.tutorMessage.create({data:{sessionId:id,role:"ASSISTANT",content:answer}});
    await prisma.tutorSession.update({where:{id},data:{updatedAt:new Date()}});
    res.status(200); res.setHeader("Content-Type","text/event-stream"); res.setHeader("Cache-Control","no-cache"); res.setHeader("Connection","keep-alive");
    for(let i=0;i<answer.length;i+=80) res.write(`data: ${JSON.stringify({type:"delta",content:answer.slice(i,i+80)})}\n\n`);
    res.write(`data: ${JSON.stringify({type:"done",messageId:saved.id})}\n\n`); return res.end();
  } catch(error) { console.error("Tutor provider failed:",error); return res.status(502).json({success:false,message:"AI tutor provider is unavailable"}); }
});

router.post("/review", async (req:AuthenticatedRequest,res)=>{
  const content=req.body?.content, chapterId=req.body?.chapterId;
  if(typeof content!=="string"||!content.trim()) return res.status(400).json({success:false,message:"Content to review is required"});
  let context="";
  if(typeof chapterId==="string") { const ch=await prisma.chapter.findUnique({where:{id:chapterId},select:{title:true,content:true,module:{select:{course:{select:{programId:true}}}}}}); if(!ch) return res.status(404).json({success:false,message:"Chapter not found"}); if(!await activeProgram(req.userId!,ch.module.course.programId)) return res.status(403).json({success:false,message:"Active program enrollment required"}); context=`Chapter: ${ch.title}. Material: ${ch.content?.slice(0,12000)??"Not provided"}`; }
  try { const review=await getLlmProvider().complete([{role:"system",content:`Review the learner's work. Give concise feedback on correctness, clarity, misconceptions, and the next improvement. ${context}`},{role:"user",content:content.trim()}]); return res.json({success:true,data:{review}}); }
  catch(error){console.error("Tutor review failed:",error);return res.status(502).json({success:false,message:"AI tutor provider is unavailable"});}
});

export default router;
