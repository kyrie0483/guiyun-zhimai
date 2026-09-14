import {createNetwork,loadState,saveState} from "./domain/store.js";
import {associationEdgePath,buildAssociationAdjacency,getAssociationNeighborIds,globalAssociationPositions,radialAssociationPositions,relationLabel} from "./domain/graph.js";
import {safeReadingUrl} from "./domain/personal-reading.js";
import {createTextFragmentUrl} from "./domain/source-anchor.js";
import {createNetworkEdge,createNetworkNode,deleteNetworkEdge,deleteNetworkNode,updateNetworkEdge,updateNetworkNode} from "./domain/network-editor.js";
import {auditGuiyunState} from "./domain/product-guardrails.js";

document.body.insertAdjacentHTML("beforeend",`<div id="object-dialog" class="modal" hidden><form id="object-form"><h2 id="object-dialog-title">编辑</h2><input id="object-kind" type="hidden"><input id="object-id" type="hidden"><label>标题<input id="object-title" maxlength="200" required></label><label id="relation-type-row">关系类型<select id="object-relation"><option value="related">相关</option><option value="supports">支持</option><option value="supplements">补充</option><option value="contradicts">对照</option><option value="condition_of">条件</option><option value="example_of">示例</option></select></label><label>说明<textarea id="object-note" maxlength="10000"></textarea></label><div><button type="button" id="object-cancel">取消</button><button class="primary">保存修改</button></div></form></div>`);
document.body.insertAdjacentHTML("beforeend",`<div id="ai-dialog" class="modal" hidden><section class="ai-workbench"><header><div><span>归云网络助手</span><h2>整理知识网络</h2></div><button id="ai-close" aria-label="关闭">×</button></header><div class="ai-fields"><label>目标网络<select id="ai-network-target"></select></label><label>执行动作<select id="ai-action"><option value="connect">连接节点</option><option value="summarize-node">总结所选节点并写入</option><option value="summarize-edge">总结关系并写入</option><option value="summarize-network">总结整个网络并写入</option></select></label></div><section id="ai-node-scope" class="ai-scope"><header><div><b>选择参与节点</b><small id="ai-node-count">已选 0 个</small></div><input id="ai-node-search" placeholder="搜索节点名称或内容"></header><div class="ai-scope-tools"><button id="ai-select-filtered">全选筛选结果</button><button id="ai-select-isolated">仅选独立节点</button><button id="ai-clear-selection">清空</button></div><div id="ai-node-list" class="ai-node-list"></div></section><label id="ai-write-target-row">总结写入节点<select id="ai-write-target"></select></label><label id="ai-edge-target-row">选择目标关系<select id="ai-edge-target"></select></label><p id="ai-impact" class="ai-impact">AI 只生成待确认草案，不会创建节点或直接修改网络。</p><footer><button id="ai-cancel">取消</button><button id="ai-submit" class="primary">生成待确认草案</button></footer></section></div>`);
document.body.insertAdjacentHTML("beforeend",`<div id="ai-settings-dialog" class="modal" hidden><form id="ai-settings-form" class="edge-create-form ai-settings-form"><header><div><span>归云网络助手</span><h2>AI 设置</h2></div><button type="button" id="ai-settings-close" aria-label="关闭">×</button></header><div class="edge-form-body ai-settings-body"><fieldset class="ai-mode-picker"><legend>使用方式</legend><label><input type="radio" name="ai-mode" value="trial"><span><b>站点试用</b><small>登录后使用共享额度</small></span></label><label><input type="radio" name="ai-mode" value="own"><span><b>自带 API Key</b><small>仅在当前标签页有效</small></span></label></fieldset><p id="ai-trial-status" class="ai-trial-status">读取额度中…</p><section id="ai-own-settings"><div class="ai-model-grid"><label>供应商<select id="ai-provider"></select></label><label>模型<select id="ai-model"></select></label></div><label>API Key<input id="ai-api-key" type="password" autocomplete="off" maxlength="1000" placeholder="输入所选供应商的 API Key"></label></section><p class="ai-security-note">本次所选节点内容将发送给模型；请勿提交敏感信息。</p></div><footer><button type="button" id="ai-settings-cancel">取消</button><button class="primary">保存</button></footer></form></div>`);
let state=loadState(),selected=new Set(),focused=null;
const networkViews=new Map();
const $=s=>document.querySelector(s);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const safeAvatar=value=>{try{const url=new URL(value);return url.protocol==="https:"?url.href:""}catch{return""}};
function renderAccountLink(user){const avatar=safeAvatar(user.avatar);const initial=esc(String(user.name||"知").slice(0,1));$("#login").innerHTML=`<span class="account-avatar">${avatar?`<img src="${esc(avatar)}" alt="" referrerpolicy="no-referrer">`:initial}</span><span>${esc(user.name||"知乎用户")}</span>`;$("#login").href="/profile";$("#login").title="查看我的知乎资料";$("#login").classList.add("account-link")}
const network=()=>state.networks.find(n=>n.id===state.activeNetworkId)??state.networks[0];
const toast=m=>{const e=$("#toast");e.textContent=m;e.className="show";setTimeout(()=>e.className="",2600)};
$("#toast").setAttribute("role","status");$("#toast").setAttribute("aria-live","polite");
for(const dialog of document.querySelectorAll(".modal")){dialog.setAttribute("role","dialog");dialog.setAttribute("aria-modal","true")}
document.addEventListener("keydown",event=>{
  if(event.key!=="Escape")return;
  const open=[...document.querySelectorAll(".modal:not([hidden])")].at(-1);
  if(open){open.hidden=true;event.preventDefault()}
});
async function request(url,options){const r=await fetch(url,options),p=await r.json();if(!r.ok)throw new Error(p.error?.message??"请求失败");return p}
const AI_PREFERENCES_KEY="guiyun-zhimai:ai-preferences:v1",AI_SECRETS_KEY="guiyun-zhimai:ai-session-secrets:v1";
let aiConfig={providers:[],trial:{available:false,loginRequired:true}};
function readJsonStorage(storage,key){try{return JSON.parse(storage.getItem(key)||"{}")??{}}catch{return{}}}
function readAiSettings(){const preferences=readJsonStorage(localStorage,AI_PREFERENCES_KEY),secrets=readJsonStorage(sessionStorage,AI_SECRETS_KEY),provider=aiConfig.providers.some(item=>item.id===preferences.provider)?preferences.provider:(aiConfig.providers[0]?.id||"deepseek"),definition=aiConfig.providers.find(item=>item.id===provider),model=definition?.models.includes(preferences.models?.[provider])?preferences.models[provider]:definition?.models[0]||"";return{mode:preferences.mode==="own"?"own":"trial",provider,model,apiKey:String(secrets.apiKeys?.[provider]||"")}}
function saveAiSettings(settings){const preferences=readJsonStorage(localStorage,AI_PREFERENCES_KEY),secrets=readJsonStorage(sessionStorage,AI_SECRETS_KEY),models={...(preferences.models||{}),[settings.provider]:settings.model},apiKeys={...(secrets.apiKeys||{}),[settings.provider]:settings.apiKey.trim()};localStorage.setItem(AI_PREFERENCES_KEY,JSON.stringify({mode:settings.mode,provider:settings.provider,models}));sessionStorage.setItem(AI_SECRETS_KEY,JSON.stringify({apiKeys}))}
function aiSelection(){const settings=readAiSettings();return settings.mode==="own"?{mode:"own",provider:settings.provider,model:settings.model,apiKey:settings.apiKey}:{mode:"trial"}}
function renderAiModels(preferred=""){const provider=aiConfig.providers.find(item=>item.id===$("#ai-provider").value),models=provider?.models||[];$("#ai-model").innerHTML=models.map(model=>`<option value="${esc(model)}">${esc(model)}</option>`).join("");$("#ai-model").value=models.includes(preferred)?preferred:models[0]||""}
function renderTrialStatus(){const trial=aiConfig.trial;if(trial.available&&Number.isFinite(trial.remaining))$("#ai-trial-status").textContent=`剩余 ${Number(trial.remaining).toLocaleString()} / ${Number(trial.limit).toLocaleString()} Token`;else if(trial.available&&trial.loginRequired)$("#ai-trial-status").textContent="登录知乎后可使用";else $("#ai-trial-status").textContent="站点暂未开放试用，请使用自己的 Key"}
function syncAiModeFields(mode){$("#ai-own-settings").hidden=mode!=="own";$("#ai-trial-status").hidden=mode!=="trial"}
function openAiSettings(){const settings=readAiSettings();$("#ai-provider").innerHTML=aiConfig.providers.map(item=>`<option value="${esc(item.id)}">${esc(item.name)}</option>`).join("");$("#ai-provider").value=settings.provider;renderAiModels(settings.model);$("#ai-api-key").value=settings.apiKey;document.querySelector(`input[name="ai-mode"][value="${settings.mode}"]`).checked=true;syncAiModeFields(settings.mode);renderTrialStatus();$("#ai-settings-dialog").hidden=false}
function aiSourceLabel(ai,demo){return demo?"演示 AI":ai?.mode==="trial"?`站点试用 · ${ai.provider}`:ai?.provider||"AI"}
function persist(){network().updatedAt=new Date().toISOString();saveState(state);renderNetworkSelector();renderNetwork()}

async function init(){
  const parameters=new URLSearchParams(location.search),requestedNetwork=parameters.get("network"),requestedNode=parameters.get("node");if(requestedNetwork&&state.networks.some(item=>item.id===requestedNetwork))state.activeNetworkId=requestedNetwork;
  renderNetworkSelector();
  try{aiConfig=await request("/api/ai/config")}catch{}
  try{const h=await request("/api/health");$("#api-state").textContent=h.zhihuConfigured?"知乎接口已连接":"赛事内容模式";$("#api-state").classList.toggle("ok",h.zhihuConfigured);if(!h.oauthConfigured){$("#login").textContent="知乎登录";$("#login").href="/api/auth/zhihu/start";$("#login").title="使用知乎账号登录"}}catch{$("#api-state").textContent="服务异常"}
  try{const s=await request("/api/auth/session");if(s.user)renderAccountLink(s.user)}catch{}
  const issues=auditGuiyunState(state);if(issues.length)console.warn("归云数据约束检查发现问题",issues);
  renderNetwork();const initialNode=network().nodes.find(item=>item.id===requestedNode);if(initialNode){focused={kind:"node",id:initialNode.id};networkViews.set(network().id,{centerId:initialNode.id,history:[initialNode.id],historyIndex:0,selectionMode:false,viewMode:"network",scale:1,panX:0,panY:0,overviewExpanded:false});showNode(initialNode);renderNetwork()}
}

$("#ai-settings").onclick=openAiSettings;$("#ai-settings-close").onclick=$("#ai-settings-cancel").onclick=()=>$("#ai-settings-dialog").hidden=true;
document.querySelectorAll('input[name="ai-mode"]').forEach(input=>input.onchange=()=>syncAiModeFields(input.value));
$("#ai-provider").onchange=()=>{const profile=readAiSettings();renderAiModels(profile.provider===$("#ai-provider").value?profile.model:"");$("#ai-api-key").value=readJsonStorage(sessionStorage,AI_SECRETS_KEY).apiKeys?.[$("#ai-provider").value]||""};
$("#ai-settings-form").onsubmit=event=>{event.preventDefault();const mode=document.querySelector('input[name="ai-mode"]:checked')?.value||"trial",settings={mode,provider:$("#ai-provider").value,model:$("#ai-model").value,apiKey:$("#ai-api-key").value};if(mode==="own"&&!settings.apiKey.trim())return toast("请输入当前供应商的 API Key");if(mode==="trial"&&(!aiConfig.trial.available||aiConfig.trial.loginRequired))return toast(aiConfig.trial.loginRequired?"请先登录知乎，或使用自己的 API Key":"站点试用暂未开放，请使用自己的 API Key");saveAiSettings(settings);$("#ai-settings-dialog").hidden=true;toast(mode==="own"?"已保存当前标签页的 AI 设置":"已切换到站点试用")};

function renderNetworkSelector(){
  const select=$("#network-select");
  select.innerHTML=state.networks.map(n=>`<option value="${esc(n.id)}">${esc(n.name)}</option>`).join("");
  select.value=network().id;
}
$("#network-select").onchange=e=>{
  if(!state.networks.some(n=>n.id===e.target.value))return;
  state.activeNetworkId=e.target.value;selected.clear();focused=null;saveState(state);$("#node-detail").innerHTML="<p>选择节点或关系查看详情。</p>";renderNetwork();toast(`已切换到「${network().name}」`);
};
$("#create-network").onclick=()=>{$("#network-name").value="";$("#network-dialog").hidden=false;$("#network-name").focus()};
$("#network-cancel").onclick=()=>$("#network-dialog").hidden=true;
$("#network-form").onsubmit=e=>{
  e.preventDefault();const name=$("#network-name").value.trim();if(!name)return;
  if(state.networks.some(n=>n.name.toLocaleLowerCase()===name.toLocaleLowerCase()))return toast("已经存在同名知识网络");
  const item=createNetwork({name});state.networks.push(item);state.activeNetworkId=item.id;selected.clear();$("#network-dialog").hidden=true;persist();toast(`已创建「${item.name}」`);
};

const aiDraft={networkId:"",action:"connect",nodeIds:new Set(),edgeId:"",search:""};
function aiTargetNetwork(){return state.networks.find(item=>item.id===aiDraft.networkId)??network()}
function openAiWorkbench(action="connect"){
  aiDraft.networkId=network().id;aiDraft.action=action;aiDraft.nodeIds=new Set(selected);aiDraft.edgeId="";aiDraft.search="";
  $("#ai-network-target").innerHTML=state.networks.map(item=>`<option value="${esc(item.id)}">${esc(item.name)} · ${item.nodes.length} 节点</option>`).join("");$("#ai-network-target").value=aiDraft.networkId;$("#ai-action").value=action;$("#ai-node-search").value="";renderAiWorkbench();$("#ai-dialog").hidden=false;
}
function renderAiWorkbench(){
  const n=aiTargetNetwork(),action=aiDraft.action,query=aiDraft.search.toLocaleLowerCase(),filtered=n.nodes.filter(node=>!query||`${node.title} ${node.note||""} ${node.anchor?.selectedText||""}`.toLocaleLowerCase().includes(query)),incident=new Set(n.edges.flatMap(edge=>[edge.sourceNodeId,edge.targetNodeId]));
  $("#ai-node-scope").hidden=action==="summarize-network"||action==="summarize-edge";$("#ai-write-target-row").hidden=action!=="summarize-node";$("#ai-edge-target-row").hidden=action!=="summarize-edge";$("#ai-select-isolated").hidden=action!=="connect";$("#ai-node-count").textContent=`已选 ${aiDraft.nodeIds.size}/${n.nodes.length} 个`;
  $("#ai-node-list").innerHTML=filtered.length?filtered.map(node=>`<label><input type="checkbox" data-ai-node="${node.id}" ${aiDraft.nodeIds.has(node.id)?"checked":""}><span><b>${esc(node.title)}</b><small>${incident.has(node.id)?"已连接":"独立节点 · 尚未连接"}</small></span></label>`).join(""):'<p class="empty">没有匹配的节点</p>';
  $("#ai-node-list").querySelectorAll("[data-ai-node]").forEach(input=>input.onchange=()=>{input.checked?aiDraft.nodeIds.add(input.dataset.aiNode):aiDraft.nodeIds.delete(input.dataset.aiNode);renderAiWorkbench()});
  $("#ai-write-target").innerHTML='<option value="">请选择写入节点</option>'+n.nodes.map(node=>`<option value="${node.id}">${esc(node.title)}</option>`).join("");if(aiDraft.nodeIds.size===1)$("#ai-write-target").value=[...aiDraft.nodeIds][0];
  $("#ai-edge-target").innerHTML='<option value="">请选择关系</option>'+n.edges.map(edge=>{const source=n.nodes.find(node=>node.id===edge.sourceNodeId),target=n.nodes.find(node=>node.id===edge.targetNodeId);return`<option value="${edge.id}">${esc(source?.title)} — ${esc(edge.title||relationLabel(edge.relationType))} — ${esc(target?.title)}</option>`}).join("");$("#ai-edge-target").value=aiDraft.edgeId;
  const hints={connect:"选择至少两个节点。可只选择尚未连入网络的独立节点。","summarize-node":"可综合多个节点，并明确指定总结写入哪个节点。","summarize-edge":"根据关系两端节点与来源，生成关系说明草案。","summarize-network":"使用目标网络中的全部节点与关系生成网络说明草案。"};$("#ai-impact").textContent=`${hints[action]} AI 只生成待确认草案。`;
}
$("#ai-network-target").onchange=event=>{aiDraft.networkId=event.target.value;aiDraft.nodeIds.clear();aiDraft.edgeId="";renderAiWorkbench()};$("#ai-action").onchange=event=>{aiDraft.action=event.target.value;renderAiWorkbench()};$("#ai-node-search").oninput=event=>{aiDraft.search=event.target.value;renderAiWorkbench()};$("#ai-edge-target").onchange=event=>aiDraft.edgeId=event.target.value;
$("#ai-select-filtered").onclick=()=>{const n=aiTargetNetwork(),query=aiDraft.search.toLocaleLowerCase();n.nodes.filter(node=>!query||`${node.title} ${node.note||""} ${node.anchor?.selectedText||""}`.toLocaleLowerCase().includes(query)).forEach(node=>aiDraft.nodeIds.add(node.id));renderAiWorkbench()};
$("#ai-select-isolated").onclick=()=>{const n=aiTargetNetwork(),incident=new Set(n.edges.flatMap(edge=>[edge.sourceNodeId,edge.targetNodeId]));aiDraft.nodeIds=new Set(n.nodes.filter(node=>!incident.has(node.id)).map(node=>node.id));renderAiWorkbench()};$("#ai-clear-selection").onclick=()=>{aiDraft.nodeIds.clear();renderAiWorkbench()};$("#ai-close").onclick=$("#ai-cancel").onclick=()=>$("#ai-dialog").hidden=true;
$("#ai-submit").onclick=async()=>{
  const n=aiTargetNetwork(),task=aiDraft.action;let ids=task==="summarize-network"?n.nodes.map(node=>node.id):[...aiDraft.nodeIds],edgeId="",writeNodeId="";
  if(task==="connect"&&ids.length<2)return toast("请至少选择两个参与连边的节点");if(task==="summarize-node"&&!ids.length)return toast("请至少选择一个待总结节点");if(task==="summarize-node"){writeNodeId=$("#ai-write-target").value;if(!writeNodeId)return toast("请选择总结写入节点")}if(task==="summarize-edge"){edgeId=$("#ai-edge-target").value;const edge=n.edges.find(item=>item.id===edgeId);if(!edge)return toast("请选择要总结的关系");ids=[edge.sourceNodeId,edge.targetNodeId]}if(!ids.length)return toast("目标网络没有可处理节点");if(ids.length>120)return toast("单次最多处理 120 个节点，请缩小范围");
  const nodes=ids.map(id=>n.nodes.find(node=>node.id===id)).filter(Boolean).map(node=>({id:node.id,title:node.title,note:node.note,excerpt:node.anchor?.selectedText||node.source.excerpt})),button=$("#ai-submit");button.disabled=true;button.textContent="AI 生成中…";
  try{const data=await request("/api/zhihu/ai",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({task,nodes,existingEdges:n.edges,edgeId,ai:aiSelection()})}),batchId=crypto.randomUUID();if(task==="connect"){for(const edge of data.result.edges??[])n.proposals.push({id:crypto.randomUUID(),batchId,kind:"edge",status:"pending",payload:edge,demo:data.demo,ai:data.ai})}else n.proposals.push({id:crypto.randomUUID(),batchId,kind:task,status:"pending",nodeId:writeNodeId||null,edgeId:edgeId||null,targetNodeIds:ids,payload:data.result,demo:data.demo,ai:data.ai});if(data.ai?.quota)aiConfig.trial={...aiConfig.trial,...data.ai.quota};state.activeNetworkId=n.id;selected.clear();saveState(state);renderNetworkSelector();renderNetwork();$("#ai-dialog").hidden=true;toast(`已由 ${data.ai?.provider||"AI"} 生成待确认草案`)}catch(error){toast(error.message)}finally{button.disabled=false;button.textContent="生成待确认草案"}
};
$("#ai-connect").onclick=()=>openAiWorkbench("connect");$("#ai-node").onclick=()=>openAiWorkbench("summarize-node");$("#ai-network").onclick=()=>openAiWorkbench("summarize-network");

function openNodeCreator(){$("#node-title").value="";$("#node-note").value="";$("#node-error").hidden=true;$("#node-dialog").hidden=false;$("#node-title").focus()}
$("#create-node").onclick=openNodeCreator;$("#node-close").onclick=$("#node-cancel").onclick=()=>$("#node-dialog").hidden=true;
$("#node-form").onsubmit=event=>{
  event.preventDefault();const n=network(),error=$("#node-error");error.hidden=true;
  try{
    const node=createNetworkNode(n,{title:$("#node-title").value,note:$("#node-note").value}),view=networkViews.get(n.id);
    focused={kind:"node",id:node.id};selected.clear();if(view)centerOnNode(view,node.id);$("#node-dialog").hidden=true;persist();showNode(node);toast("节点已创建，等待一键整合");
  }catch(problem){error.textContent=problem.message;error.hidden=false}
};

const relationTypeValues=["related","supports","supplements","contradicts","condition_of","example_of"];
function edgePairExists(n,sourceId,targetId){const pair=[sourceId,targetId].sort().join(":");return n.edges.some(edge=>[edge.sourceNodeId,edge.targetNodeId].sort().join(":")===pair)}
function availableEdgeTargets(n,sourceId){return n.nodes.filter(node=>node.id!==sourceId&&!edgePairExists(n,sourceId,node.id))}
function hasAvailableEdgePair(n){return n.nodes.some(node=>availableEdgeTargets(n,node.id).length)}
function renderEdgeTargetOptions(preferredId=""){
  const n=network(),sourceId=$("#edge-source").value,targets=availableEdgeTargets(n,sourceId);
  $("#edge-target").innerHTML=targets.length?targets.map(node=>`<option value="${esc(node.id)}">${esc(node.title)}</option>`).join(""):'<option value="">没有可连接的节点</option>';
  $("#edge-target").value=targets.some(node=>node.id===preferredId)?preferredId:targets[0]?.id??"";$("#edge-target").disabled=!targets.length;
}
function openEdgeCreator(){
  const n=network();if(!hasAvailableEdgePair(n))return toast(n.nodes.length<2?"至少需要两个节点才能建立关系":"所有节点组合都已经存在关系");
  const chosen=[...selected].filter(id=>n.nodes.some(node=>node.id===id)),view=networkViews.get(n.id),focusedNode=focused?.kind==="node"?focused.id:"";
  let sourceId=chosen[0]||focusedNode||view?.centerId||n.nodes[0].id,targetId=chosen.find(id=>id!==sourceId&&!edgePairExists(n,sourceId,id))||"";
  if(!availableEdgeTargets(n,sourceId).length)sourceId=n.nodes.find(node=>availableEdgeTargets(n,node.id).length)?.id??sourceId;
  $("#edge-source").innerHTML=n.nodes.map(node=>`<option value="${esc(node.id)}">${esc(node.title)}</option>`).join("");$("#edge-source").value=sourceId;renderEdgeTargetOptions(targetId);
  $("#edge-relation").value="related";$("#edge-title").value=relationLabel("related");$("#edge-note").value="";$("#edge-error").hidden=true;$("#edge-dialog").hidden=false;$("#edge-target").focus();
}
$("#create-edge").onclick=openEdgeCreator;$("#edge-source").onchange=()=>renderEdgeTargetOptions();
$("#edge-relation").onchange=event=>{const input=$("#edge-title"),labels=relationTypeValues.map(relationLabel);if(!input.value.trim()||labels.includes(input.value.trim()))input.value=relationLabel(event.target.value)};
$("#edge-close").onclick=$("#edge-cancel").onclick=()=>$("#edge-dialog").hidden=true;
$("#edge-form").onsubmit=event=>{
  event.preventDefault();const n=network(),error=$("#edge-error");error.hidden=true;
  try{const edge=createNetworkEdge(n,{sourceNodeId:$("#edge-source").value,targetNodeId:$("#edge-target").value,relationType:$("#edge-relation").value,title:$("#edge-title").value,note:$("#edge-note").value});focused={kind:"edge",id:edge.id};$("#edge-dialog").hidden=true;persist();showEdge(edge);toast("关系已创建")}
  catch(problem){error.textContent=problem.message;error.hidden=false}
};

function newIntegrationNodes(n=network()){return n.nodes.filter(node=>node.integrationStatus==="new")}
function integrationCatalog(n,candidateIds,limit=120){const candidates=n.nodes.filter(node=>candidateIds.has(node.id)),existing=n.nodes.filter(node=>!candidateIds.has(node.id)).sort((left,right)=>String(right.createdAt??"").localeCompare(String(left.createdAt??"")));return [...candidates,...existing].slice(0,limit)}
$("#integrate-new").onclick=async()=>{
  const n=network(),candidates=newIntegrationNodes(n);if(!candidates.length)return toast("当前没有待整合的新增节点");if(n.nodes.length<2)return toast("至少需要两个节点才能建立关系");if(candidates.length>30)return toast("归云单次最多整合 30 个新增节点，请先分批处理");
  const candidateIds=new Set(candidates.map(node=>node.id)),nodes=integrationCatalog(n,candidateIds).map(node=>({id:node.id,title:node.title,note:node.note,excerpt:node.anchor?.selectedText||node.source.excerpt})),button=$("#integrate-new");button.disabled=true;button.querySelector("span").textContent="正在整合";button.setAttribute("aria-label","正在整合新增节点");
  try{
    const data=await request("/api/zhihu/ai",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({task:"integrate",nodes,candidateNodeIds:[...candidateIds],existingEdges:n.edges,ai:aiSelection()})}),batchId=crypto.randomUUID();
    for(const edge of data.result.edges??[])n.proposals.push({id:crypto.randomUUID(),batchId,kind:"edge",status:"pending",payload:edge,demo:data.demo,ai:data.ai,integrationCandidateNodeIds:[...candidateIds]});
    if(data.ai?.quota)aiConfig.trial={...aiConfig.trial,...data.ai.quota};
    for(const node of candidates){node.integrationStatus="reviewed";node.integrationBatchId=batchId;node.integratedAt=new Date().toISOString()}
    saveState(state);renderNetwork();toast((data.result.edges??[]).length?`已为 ${candidates.length} 个新增节点生成待确认关系`:`已检查 ${candidates.length} 个新增节点，暂未发现可靠关系`);
  }catch(error){toast(`整合失败：${error.message}`)}finally{button.disabled=false;button.querySelector("span").textContent="一键整合新增节点";button.setAttribute("aria-label","一键整合新增节点")}
};

function renderNetwork(){
  const n=network(),newCount=newIntegrationNodes(n).length,canCreateEdge=hasAvailableEdgePair(n),summary=String(n.summary||"").trim();$("#active-network-name").textContent=n.name;$("#node-count").textContent=n.nodes.length;$("#edge-count").textContent=n.edges.length;$("#new-node-count").textContent=newCount;$("#integrate-new").disabled=newCount===0;$("#integrate-new").title=newCount?`${newCount} 个新增节点等待整合`:"没有待整合的新增节点";$("#create-edge").disabled=!canCreateEdge;$("#create-edge").title=canCreateEdge?"选择起点和目标节点，手动建立关系":n.nodes.length<2?"至少需要两个节点":"所有节点组合都已有关系";$("#summary").textContent=summary;$("#summary").title=summary;$("#summary").hidden=!summary;
  const g=$("#graph"),w=g.clientWidth||430,h=g.clientHeight||430;
  let view=networkViews.get(n.id);
  if(!view||!n.nodes.some(node=>node.id===view.centerId)){view={centerId:n.nodes[0]?.id??"",history:n.nodes[0]?[n.nodes[0].id]:[],historyIndex:n.nodes[0]?0:-1,selectionMode:false,viewMode:"network",scale:1,panX:0,panY:0,overviewExpanded:false};networkViews.set(n.id,view)}
  view.panX??=0;view.panY??=0;
  if(!n.nodes.length){g.innerHTML='<div class="graph-watermark">归云网络</div><div class="graph-empty"><b>暂无节点</b></div>';$("#node-detail").innerHTML="<p>暂无对象</p>";renderProposals();return}
  const adjacency=buildAssociationAdjacency(n.edges),neighborIds=getAssociationNeighborIds(view.centerId,adjacency),center=n.nodes.find(node=>node.id===view.centerId),tooMany=neighborIds.length>10,effectiveView=tooMany?"list":view.viewMode;
  const toolbar=`<div class="stage-tools left"><button data-selection-mode aria-pressed="${view.selectionMode}" aria-label="${view.selectionMode?"退出节点多选":"选择多个节点"}" title="${view.selectionMode?"退出节点多选":"选择多个节点"}">${view.selectionMode?"完成选择":"选择节点"}</button>${view.selectionMode?`<button data-select-all>${selected.size===n.nodes.length?"取消全选":"全选网络"}</button>`:""}</div><div class="stage-tools right"><button data-view="network" class="${effectiveView==="network"?"active":""}" ${tooMany?"disabled":""}>网络</button><button data-view="list" class="${effectiveView==="list"?"active":""}">列表</button></div>`;
  const history=`<div class="center-history"><button data-history="${view.historyIndex-1}" ${view.historyIndex<=0?"disabled":""}>‹</button>${view.history.map((id,index)=>`<button data-history="${index}" class="${index===view.historyIndex?"active":""}">${esc(n.nodes.find(node=>node.id===id)?.title??"已删除")}</button>`).join("")}<button data-history="${view.historyIndex+1}" ${view.historyIndex>=view.history.length-1?"disabled":""}>›</button></div>`;
  const zoom=`<div class="zoom-tools"><button data-zoom="in" aria-label="放大画布" title="放大">＋</button><button data-zoom="out" aria-label="缩小画布" title="缩小">－</button><button data-zoom="reset" aria-label="重置画布位置" title="重置画布位置">◎</button></div>`;
  g.innerHTML=`<div class="network-stage">${toolbar}<div class="stage-content"></div>${history}${zoom}</div><div class="graph-watermark">归云网络</div>`;
  const stage=g.querySelector(".stage-content");
  if(effectiveView==="list"){
    stage.innerHTML=`<div class="neighbor-list"><button class="center-card ${selected.has(center.id)?"selected":""} ${focused?.kind==="node"&&focused.id===center.id?"focused":""}" data-node="${center.id}">${esc(center.title)}</button><div class="neighbor-items">${neighborIds.map(id=>{const node=n.nodes.find(item=>item.id===id),edge=(adjacency.get(view.centerId)??[]).find(item=>item.sourceNodeId===id||item.targetNodeId===id);return`<article><button data-edge="${edge?.id??""}" class="${focused?.kind==="edge"&&focused.id===edge?.id?"focused":""}" title="${esc(edge?.title??"关系")}">—</button><button data-node="${id}" class="${selected.has(id)?"selected":""} ${focused?.kind==="node"&&focused.id===id?"focused":""}"><b>${esc(node?.title)}</b><span>${esc(node?.note||"暂无说明")}</span></button></article>`}).join("")}</div></div>`;
  }else{
    const pos=radialAssociationPositions(neighborIds,w,h);
    const centerPoint={x:w/2,y:h/2};for(const point of pos.values()){point.x=centerPoint.x+(point.x-centerPoint.x)*view.scale;point.y=centerPoint.y+(point.y-centerPoint.y)*view.scale}
    const mainEdges=(adjacency.get(view.centerId)??[]).filter(edge=>neighborIds.includes(edge.sourceNodeId===view.centerId?edge.targetNodeId:edge.sourceNodeId));
    stage.innerHTML=`<div class="stage-viewport" style="transform:translate(${view.panX}px,${view.panY}px)"><svg viewBox="0 0 ${w} ${h}">${mainEdges.map(edge=>{const other=edge.sourceNodeId===view.centerId?edge.targetNodeId:edge.sourceNodeId,p=pos.get(other);return`<path class="edge-visible ${focused?.kind==="edge"&&focused.id===edge.id?"active":""}" d="${associationEdgePath(centerPoint,p,{curved:false,seed:edge.id})}"/><path class="edge-hit" data-object data-edge="${edge.id}" d="${associationEdgePath(centerPoint,p,{curved:false,seed:edge.id})}"/><text x="${(centerPoint.x+p.x)/2}" y="${(centerPoint.y+p.y)/2-7}">${esc(edge.title||relationLabel(edge.relationType))}</text>`}).join("")}</svg></div>`;
    const viewport=stage.querySelector(".stage-viewport");
    const addNode=(node,point,isCenter)=>{const button=document.createElement("button");button.className=`stage-node ${isCenter?"center":""} ${selected.has(node.id)?"selected":""} ${focused?.kind==="node"&&focused.id===node.id?"focused":""}`;button.dataset.node=node.id;button.dataset.object="";button.title=isCenter?`${node.title}（当前中心节点）`:`${node.title}（双击设为中心）`;button.setAttribute("aria-pressed",String(selected.has(node.id)||focused?.kind==="node"&&focused.id===node.id));button.style.left=`${point.x}px`;button.style.top=`${point.y}px`;button.innerHTML=`<span>${esc(node.title)}</span>${view.selectionMode?`<i>${selected.has(node.id)?"✓":""}</i>`:""}`;viewport.append(button)};
    addNode(center,centerPoint,true);for(const id of neighborIds){const node=n.nodes.find(item=>item.id===id);if(node)addNode(node,pos.get(id),false)}
    installStagePan(stage,viewport,view);
  }
  renderAssociationOverview(g,n,view,w,h);
  g.querySelector("[data-selection-mode]").onclick=()=>{view.selectionMode=!view.selectionMode;if(!view.selectionMode)selected.clear();renderNetwork()};
  g.querySelector("[data-select-all]")?.addEventListener("click",()=>{if(selected.size===n.nodes.length)selected.clear();else n.nodes.forEach(node=>selected.add(node.id));renderNetwork()});
  g.querySelectorAll("[data-view]").forEach(button=>button.onclick=()=>{view.viewMode=button.dataset.view;renderNetwork()});
  g.querySelectorAll("[data-history]").forEach(button=>button.onclick=()=>{const index=Number(button.dataset.history);if(index<0||index>=view.history.length)return;view.historyIndex=index;view.centerId=view.history[index];resetViewport(view);renderNetwork()});
  g.querySelector("[data-zoom=in]").onclick=()=>{view.scale=Math.min(1.55,view.scale+.15);renderNetwork()};g.querySelector("[data-zoom=out]").onclick=()=>{view.scale=Math.max(.55,view.scale-.15);renderNetwork()};g.querySelector("[data-zoom=reset]").onclick=()=>{resetViewport(view);renderNetwork()};
  g.querySelectorAll("[data-node]").forEach(button=>{let clickTimer;button.onclick=()=>{clearTimeout(clickTimer);clickTimer=setTimeout(()=>{const node=n.nodes.find(item=>item.id===button.dataset.node);if(!node)return;if(view.selectionMode){selected.has(node.id)?selected.delete(node.id):selected.add(node.id);renderNetwork()}else{focused={kind:"node",id:node.id};showNode(node);renderNetwork()}},180)};button.ondblclick=event=>{event.preventDefault();clearTimeout(clickTimer);const node=n.nodes.find(item=>item.id===button.dataset.node);if(!node)return;focused={kind:"node",id:node.id};centerOnNode(view,node.id);showNode(node);renderNetwork()}});
  g.querySelectorAll("[data-edge]").forEach(path=>path.onclick=event=>{event.stopPropagation();if(view.selectionMode)return;const edge=n.edges.find(item=>item.id===path.dataset.edge);if(edge){focused={kind:"edge",id:edge.id};showEdge(edge);renderNetwork()}});
  renderProposals();
}
function resetViewport(view){view.scale=1;view.panX=0;view.panY=0}
function centerOnNode(view,id){if(view.centerId===id){resetViewport(view);return}view.history=[...view.history.slice(0,view.historyIndex+1),id].slice(-5);view.historyIndex=view.history.length-1;view.centerId=id;resetViewport(view)}
function installStagePan(stage,viewport,view){
  let drag=null;
  stage.onpointerdown=event=>{if(event.button!==0||event.target.closest("[data-object],button,a,input,textarea,select"))return;event.preventDefault();getSelection()?.removeAllRanges();drag={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,panX:view.panX,panY:view.panY,moved:false};stage.setPointerCapture?.(event.pointerId)};
  stage.onpointermove=event=>{if(!drag||drag.pointerId!==event.pointerId)return;const dx=event.clientX-drag.startX,dy=event.clientY-drag.startY;if(!drag.moved&&Math.hypot(dx,dy)<3)return;drag.moved=true;view.panX=drag.panX+dx;view.panY=drag.panY+dy;viewport.style.transform=`translate(${view.panX}px,${view.panY}px)`;stage.classList.add("dragging")};
  const finish=event=>{if(!drag||drag.pointerId!==event.pointerId)return;stage.releasePointerCapture?.(event.pointerId);drag=null;stage.classList.remove("dragging")};stage.onpointerup=finish;stage.onpointercancel=finish;
}
function truncateOverviewTitle(value,max=15){const characters=Array.from(String(value??""));return characters.length>max?`${characters.slice(0,max).join("")}…`:characters.join("")}
function overviewBoundsOverlap(left,right){return left.left<right.right+5&&left.right>right.left-5&&left.top<right.bottom+4&&left.bottom>right.top-4}
function overviewOverlapArea(left,right){return Math.max(0,Math.min(left.right,right.right)-Math.max(left.left,right.left))*Math.max(0,Math.min(left.bottom,right.bottom)-Math.max(left.top,right.top))}
function layoutOverviewLabels(nodes,positions,width,height){
  const occupied=[{left:3,top:3,right:51,bottom:51}],labels=new Map();
  for(const node of nodes){
    const point=positions.get(node.id);if(!point)continue;
    const title=truncateOverviewTitle(node.title),textWidth=Math.min(Math.max(Array.from(title).reduce((total,character)=>total+(/[^\x00-\xff]/.test(character)?12:7),0),24),Math.max(24,width-12)),textHeight=18;
    const offsets=[{x:10,y:-10},{x:10,y:18},{x:-textWidth-10,y:-10},{x:-textWidth-10,y:18},{x:-textWidth/2,y:-17},{x:-textWidth/2,y:24}];
    const candidates=offsets.map(offset=>({x:point.x+offset.x,y:point.y+offset.y,left:point.x+offset.x,right:point.x+offset.x+textWidth,top:point.y+offset.y-textHeight/2,bottom:point.y+offset.y+textHeight/2})).filter(candidate=>candidate.left>=5&&candidate.right<=width-5&&candidate.top>=5&&candidate.bottom<=height-5);
    const placement=candidates.find(candidate=>!occupied.some(bounds=>overviewBoundsOverlap(candidate,bounds)))??candidates.sort((a,b)=>occupied.reduce((total,bounds)=>total+overviewOverlapArea(a,bounds),0)-occupied.reduce((total,bounds)=>total+overviewOverlapArea(b,bounds),0))[0];
    if(placement){labels.set(node.id,{...placement,title});occupied.push(placement)}
  }
  return labels;
}
function renderAssociationOverview(root,n,view,w,h){
  const expanded=view.overviewExpanded,ow=expanded?w:154,oh=expanded?h:112,pos=globalAssociationPositions(n.nodes,n.edges,ow,oh),labels=expanded?layoutOverviewLabels(n.nodes,pos,ow,oh):new Map();
  root.insertAdjacentHTML("beforeend",`<section class="association-overview ${expanded?"expanded":""}" aria-label="${expanded?"全局知识图谱画布":"全局知识图谱缩略图"}"><button class="overview-toggle" aria-label="${expanded?"还原全局知识图谱缩略图":"最大化全局知识图谱"}">${expanded?"↙":"↗"}</button><svg viewBox="0 0 ${ow} ${oh}" aria-label="全部节点缩略图">${n.edges.map(edge=>{const a=pos.get(edge.sourceNodeId),b=pos.get(edge.targetNodeId);return a&&b?`<line class="overview-edge ${focused?.kind==="edge"&&focused.id===edge.id?"focused":""}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/><line class="overview-edge-hit" data-overview-edge="${edge.id}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`:""}).join("")}${n.nodes.map(node=>{const p=pos.get(node.id);return`<circle data-overview-node="${node.id}" cx="${p.x}" cy="${p.y}" r="${node.id===view.centerId?5:3.5}" class="${node.id===view.centerId?"center":""} ${selected.has(node.id)?"selected":""} ${focused?.kind==="node"&&focused.id===node.id?"focused":""}"><title>${esc(node.title)}</title></circle>`}).join("")}${expanded?n.nodes.map(node=>{const label=labels.get(node.id);return label?`<text class="overview-node-label ${focused?.kind==="node"&&focused.id===node.id?"focused":""}" data-overview-label="${node.id}" x="${label.x}" y="${label.y}">${esc(label.title)}</text>`:""}).join(""):""}</svg></section>`);
  const overview=root.querySelector(".association-overview");overview.querySelector(".overview-toggle").onclick=()=>{view.overviewExpanded=!view.overviewExpanded;renderNetwork()};overview.querySelectorAll("[data-overview-node]").forEach(element=>element.onclick=event=>{event.stopPropagation();const node=n.nodes.find(item=>item.id===element.dataset.overviewNode);if(!node)return;if(view.selectionMode){selected.has(node.id)?selected.delete(node.id):selected.add(node.id)}else{focused={kind:"node",id:node.id};centerOnNode(view,node.id);showNode(node)}renderNetwork()});overview.querySelectorAll("[data-overview-edge]").forEach(element=>element.onclick=event=>{event.stopPropagation();if(view.selectionMode)return;const edge=n.edges.find(item=>item.id===element.dataset.overviewEdge);if(!edge)return;focused={kind:"edge",id:edge.id};showEdge(edge);renderNetwork()});
}
function showNode(n){
  const safeSourceUrl=safeReadingUrl(n.source.canonicalUrl),sourceLink=safeSourceUrl?`<a class="button" href="${esc(n.source.sourceType==="personal-markdown"?safeSourceUrl:createTextFragmentUrl(safeSourceUrl,n.anchor?.selectedText||""))}" target="_blank" rel="noopener noreferrer">打开来源网页</a>`:"";
  const readerUrl=`/?network=${encodeURIComponent(network().id)}&node=${encodeURIComponent(n.id)}`;
  const view=networkViews.get(network().id),isCenter=view?.centerId===n.id;
  const manual=n.source.sourceType==="manual",readingLink=manual?"":`<a class="button" id="jump-local" href="${readerUrl}">返回阅读位置</a>`;
  $("#node-detail").innerHTML=`<div class="detail-heading"><span class="badge">${manual?"手动":n.type==="article"?"整篇":"文段"}</span><span class="object-kind">${n.integrationStatus==="new"?"待整合 · ":""}节点</span></div><h3>${esc(n.title)}</h3>${n.anchor?`<blockquote>${esc(n.anchor.selectedText)}</blockquote>`:""}${n.note?`<p>${esc(n.note)}</p>`:""}<small>${esc(n.source.author)} · ${esc(n.source.title)}</small>${readingLink||sourceLink?`<div>${readingLink}${sourceLink}</div>`:""}<div class="object-actions"><button id="center-object" ${isCenter?"disabled":""}>${isCenter?"当前中心":"设为中心"}</button><button id="edit-object">编辑节点</button><button id="delete-object" class="danger">删除节点</button></div>`;
  $("#center-object").onclick=()=>{if(!view||isCenter)return;focused={kind:"node",id:n.id};centerOnNode(view,n.id);renderNetwork();showNode(n)};$("#edit-object").onclick=()=>openObjectEditor("node",n);$("#delete-object").onclick=()=>removeObject("node",n.id);
}
function showEdge(edge){
  const n=network(),source=n.nodes.find(node=>node.id===edge.sourceNodeId),target=n.nodes.find(node=>node.id===edge.targetNodeId);
  $("#node-detail").innerHTML=`<div class="detail-heading"><span class="badge">${esc(relationLabel(edge.relationType))}</span><span class="object-kind">关系</span></div><h3>${esc(edge.title||"未命名关系")}</h3><p class="edge-endpoints"><b>${esc(source?.title||"未知节点")}</b><span>↔</span><b>${esc(target?.title||"未知节点")}</b></p>${edge.rationale?`<p>${esc(edge.rationale)}</p>`:""}<div class="object-actions"><button id="edit-object">编辑关系</button><button id="delete-object" class="danger">删除关系</button></div>`;
  $("#edit-object").onclick=()=>openObjectEditor("edge",edge);$("#delete-object").onclick=()=>removeObject("edge",edge.id);
}
function openObjectEditor(kind,item){
  $("#object-kind").value=kind;$("#object-id").value=item.id;$("#object-title").value=item.title||"";$("#object-note").value=kind==="node"?item.note||"":item.rationale||"";$("#object-relation").value=item.relationType||"related";$("#relation-type-row").hidden=kind!=="edge";$("#object-dialog-title").textContent=kind==="node"?"编辑节点":"编辑关系";$("#object-dialog").hidden=false;$("#object-title").focus();
}
$("#object-cancel").onclick=()=>$("#object-dialog").hidden=true;
$("#object-form").onsubmit=e=>{
  e.preventDefault();const kind=$("#object-kind").value,id=$("#object-id").value,n=network();
  try{
    if(kind==="node"){const item=updateNetworkNode(n,id,{title:$("#object-title").value,note:$("#object-note").value});showNode(item)}
    else{const item=updateNetworkEdge(n,id,{title:$("#object-title").value,note:$("#object-note").value,relationType:$("#object-relation").value});showEdge(item)}
    $("#object-dialog").hidden=true;persist();toast("修改已保存");
  }catch(error){toast(error.message)}
};
function removeObject(kind,id){
  const label=kind==="node"?"节点":"关系";if(!confirm(`确定删除这个${label}吗？${kind==="node"?" 与它相连的关系和相关待确认草案也会删除。":""}`))return;
  try{
    const result=kind==="node"?deleteNetworkNode(network(),id):deleteNetworkEdge(network(),id);
    if(kind==="node")selected.delete(id);focused=null;$("#node-detail").innerHTML="<p>选择节点或关系查看详情。</p>";persist();
    const edgeCount=result.removedEdges?.length??0,proposalCount=result.removedProposals?.length??0;
    toast(`已删除${label}${edgeCount?`及 ${edgeCount} 条相邻关系`:""}${proposalCount?`，清理 ${proposalCount} 条草案`:""}`);
  }catch(error){toast(error.message)}
}
function renderProposals(){
  const list=network().proposals.filter(p=>p.status==="pending");
  $("#proposals").innerHTML=list.length?list.map(p=>`<article class="proposal"><span>${esc(aiSourceLabel(p.ai,p.demo))} · 待确认</span><h4>${p.kind==="edge"?esc(p.payload.title):p.kind==="summarize-node"?"节点总结":p.kind==="summarize-edge"?"关系总结":"网络总结"}</h4><p>${esc(p.kind==="edge"?p.payload.rationale:p.payload.note)}</p><button class="primary" data-apply="${p.id}">确认写入</button><button data-reject="${p.id}">拒绝</button></article>`).join(""):'<p class="empty">暂无待确认草案</p>';
  $("#proposals").querySelectorAll("[data-apply]").forEach(b=>b.onclick=()=>resolveProposal(b.dataset.apply,true));$("#proposals").querySelectorAll("[data-reject]").forEach(b=>b.onclick=()=>resolveProposal(b.dataset.reject,false));
}
function resolveProposal(id,apply){
  const n=network(),p=n.proposals.find(x=>x.id===id);if(!p)return;
  if(apply){if(p.kind==="edge"&&!n.edges.some(e=>[e.sourceNodeId,e.targetNodeId].sort().join()===[p.payload.sourceNodeId,p.payload.targetNodeId].sort().join()))n.edges.push({id:crypto.randomUUID(),...p.payload,createdAt:new Date().toISOString()});else if(p.kind==="summarize-node"){const x=n.nodes.find(x=>x.id===p.nodeId);if(x)x.note=p.payload.note}else if(p.kind==="summarize-edge"){const edge=n.edges.find(edge=>edge.id===p.edgeId);if(edge)edge.rationale=p.payload.note}else if(p.kind==="summarize-network")n.summary=p.payload.note}
  p.status=apply?"applied":"rejected";persist();toast(apply?"已确认写入":"已拒绝草案");
}
init();addEventListener("resize",renderNetwork);
