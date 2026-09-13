// Adapted from F:/GY/gy-913 association network service constraints.
export const RELATION_TYPES = ["supports","supplements","contradicts","condition_of","example_of","related"];

function requiredTitle(value, max=200) {
  const title=String(value??"").trim();
  if(!title)throw new Error("标题不能为空");
  if([...title].length>max)throw new Error(`标题不能超过 ${max} 个字符`);
  return title;
}
function noteValue(value){const note=String(value??"").trim();if([...note].length>10_000)throw new Error("说明不能超过 10000 个字符");return note}
function bump(network){network.revision=(network.revision??1)+1;network.updatedAt=new Date().toISOString()}
function sameTitle(left,right){return left.trim().toLocaleLowerCase("zh-CN")===right.trim().toLocaleLowerCase("zh-CN")}
function pendingReferencesNode(proposal,nodeId){
  return proposal.nodeId===nodeId||proposal.targetNodeIds?.includes(nodeId)||proposal.payload?.sourceNodeId===nodeId||proposal.payload?.targetNodeId===nodeId;
}
function proposalMatchesEdge(proposal,edge){
  const pair=[edge.sourceNodeId,edge.targetNodeId].sort().join(":");
  return proposal.kind==="edge"&&[proposal.payload?.sourceNodeId,proposal.payload?.targetNodeId].sort().join(":")===pair;
}

export function updateNetworkNode(network,nodeId,input){
  const node=network.nodes.find(item=>item.id===nodeId);if(!node)throw new Error("节点不存在");
  const title=requiredTitle(input.title);
  if(network.nodes.some(item=>item.id!==nodeId&&sameTitle(item.title,title)))throw new Error("当前网络中已存在同名节点");
  node.title=title;node.note=noteValue(input.note);node.updatedAt=new Date().toISOString();bump(network);return node;
}

export function deleteNetworkNode(network,nodeId){
  const index=network.nodes.findIndex(item=>item.id===nodeId);if(index<0)throw new Error("节点不存在");
  const [node]=network.nodes.splice(index,1);
  const removedEdges=network.edges.filter(edge=>edge.sourceNodeId===nodeId||edge.targetNodeId===nodeId);
  network.edges=network.edges.filter(edge=>edge.sourceNodeId!==nodeId&&edge.targetNodeId!==nodeId);
  const removedProposals=network.proposals.filter(proposal=>proposal.status==="pending"&&pendingReferencesNode(proposal,nodeId));
  network.proposals=network.proposals.filter(proposal=>!(proposal.status==="pending"&&pendingReferencesNode(proposal,nodeId)));
  bump(network);return {node,removedEdges,removedProposals};
}

export function updateNetworkEdge(network,edgeId,input){
  const edge=network.edges.find(item=>item.id===edgeId);if(!edge)throw new Error("关系不存在");
  edge.title=requiredTitle(input.title);edge.rationale=noteValue(input.note);
  if(!RELATION_TYPES.includes(input.relationType))throw new Error("不支持的关系类型");
  edge.relationType=input.relationType;edge.updatedAt=new Date().toISOString();bump(network);return edge;
}

export function deleteNetworkEdge(network,edgeId){
  const index=network.edges.findIndex(item=>item.id===edgeId);if(index<0)throw new Error("关系不存在");
  const [edge]=network.edges.splice(index,1);
  const removedProposals=network.proposals.filter(proposal=>proposal.status==="pending"&&proposalMatchesEdge(proposal,edge));
  network.proposals=network.proposals.filter(proposal=>!(proposal.status==="pending"&&proposalMatchesEdge(proposal,edge)));
  bump(network);return {edge,removedProposals};
}
