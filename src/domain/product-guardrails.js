export function auditGuiyunState(state) {
  const issues=[];
  for(const network of state.networks??[]){
    const ids=new Set((network.nodes??[]).map(node=>node.id));
    for(const node of network.nodes??[]){
      if(node.createdBy==="ai"||node.origin==="ai")issues.push({code:"AI_CREATED_NODE",networkId:network.id,objectId:node.id});
      if(!node.source?.snapshot&&!node.source?.canonicalUrl)issues.push({code:"NODE_WITHOUT_SOURCE",networkId:network.id,objectId:node.id});
    }
    for(const edge of network.edges??[]){
      if(edge.sourceNodeId===edge.targetNodeId)issues.push({code:"SELF_LOOP",networkId:network.id,objectId:edge.id});
      if(!ids.has(edge.sourceNodeId)||!ids.has(edge.targetNodeId))issues.push({code:"ORPHAN_EDGE",networkId:network.id,objectId:edge.id});
    }
  }
  return issues;
}
