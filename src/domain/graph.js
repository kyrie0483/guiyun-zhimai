// Adapted from F:/GY/gy-913/src/features/association-network/graph.ts.
function stableNumber(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

export function associationEdgePath(source, target, {curved=true, seed=""}={}) {
  if (!curved) return `M ${source.x} ${source.y} L ${target.x} ${target.y}`;
  const midpoint={x:(source.x+target.x)/2,y:(source.y+target.y)/2};
  const chord={x:target.x-source.x,y:target.y-source.y};
  const length=Math.max(Math.hypot(chord.x,chord.y),1);
  const sign=stableNumber(seed)<0.5?-1:1;
  const bend=Math.min(42,Math.max(14,length*.16));
  const control={x:midpoint.x+(-chord.y/length)*bend*sign,y:midpoint.y+(chord.x/length)*bend*sign};
  return `M ${source.x} ${source.y} Q ${control.x} ${control.y} ${target.x} ${target.y}`;
}

export function globalAssociationPositions(nodes, edges, width=430, height=320) {
  const ids=nodes.map(node=>node.id), set=new Set(ids);
  const validEdges=edges.filter(edge=>set.has(edge.sourceNodeId)&&set.has(edge.targetNodeId));
  const goldenAngle=Math.PI*(3-Math.sqrt(5));
  const points=new Map(ids.map((id,index)=>{
    const radius=24*Math.sqrt(index);
    const angle=index*goldenAngle+stableNumber(id)*.8;
    return [id,{x:Math.cos(angle)*radius,y:Math.sin(angle)*radius}];
  }));
  const iterations=ids.length<=80?130:70;
  for(let iteration=0;iteration<iterations;iteration+=1){
    const cooling=1-iteration/iterations;
    const force=new Map(ids.map(id=>[id,{x:0,y:0}]));
    for(let left=0;left<ids.length;left+=1){
      for(let right=left+1;right<ids.length;right+=1){
        const a=points.get(ids[left]),b=points.get(ids[right]);
        let dx=b.x-a.x,dy=b.y-a.y;
        if(Math.abs(dx)+Math.abs(dy)<.001){dx=stableNumber(ids[left]+ids[right])-.5;dy=stableNumber(ids[right]+ids[left])-.5}
        const squared=Math.max(dx*dx+dy*dy,20),distance=Math.sqrt(squared),strength=Math.min(5,2100/squared);
        const fx=dx/distance*strength,fy=dy/distance*strength;
        force.get(ids[left]).x-=fx;force.get(ids[left]).y-=fy;force.get(ids[right]).x+=fx;force.get(ids[right]).y+=fy;
      }
    }
    for(const edge of validEdges){
      const a=points.get(edge.sourceNodeId),b=points.get(edge.targetNodeId);
      const dx=b.x-a.x,dy=b.y-a.y,distance=Math.max(Math.hypot(dx,dy),.01),ideal=125,strength=(distance-ideal)*.045;
      const fx=dx/distance*strength,fy=dy/distance*strength;
      force.get(edge.sourceNodeId).x+=fx;force.get(edge.sourceNodeId).y+=fy;force.get(edge.targetNodeId).x-=fx;force.get(edge.targetNodeId).y-=fy;
    }
    for(const id of ids){
      const point=points.get(id),delta=force.get(id);
      point.x+=Math.max(-5,Math.min(5,delta.x-point.x*.004))*cooling;
      point.y+=Math.max(-5,Math.min(5,delta.y-point.y*.004))*cooling;
    }
  }
  if(!ids.length)return points;
  const xs=ids.map(id=>points.get(id).x),ys=ids.map(id=>points.get(id).y);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const paddingX=74,paddingY=48,availableX=Math.max(1,width-paddingX*2),availableY=Math.max(1,height-paddingY*2);
  const scale=Math.min(1,availableX/Math.max(1,maxX-minX),availableY/Math.max(1,maxY-minY));
  for(const id of ids){const point=points.get(id);point.x=paddingX+(point.x-minX)*scale+(availableX-(maxX-minX)*scale)/2;point.y=paddingY+(point.y-minY)*scale+(availableY-(maxY-minY)*scale)/2}
  return points;
}

export function buildAssociationAdjacency(edges) {
  const incidentByNode=new Map();
  for(const edge of edges){
    incidentByNode.set(edge.sourceNodeId,[...(incidentByNode.get(edge.sourceNodeId)??[]),edge]);
    incidentByNode.set(edge.targetNodeId,[...(incidentByNode.get(edge.targetNodeId)??[]),edge]);
  }
  return incidentByNode;
}

export function getAssociationNeighborIds(nodeId,incidentByNode) {
  return [...new Set((incidentByNode.get(nodeId)??[]).map(edge=>edge.sourceNodeId===nodeId?edge.targetNodeId:edge.sourceNodeId))];
}

export function radialAssociationPositions(ids,width=430,height=320) {
  const center={x:width/2,y:height/2};
  const radius=Math.min(width*.34,height*.34,190);
  return new Map(ids.map((id,index)=>{
    const angle=2*Math.PI*index/Math.max(ids.length,1)-Math.PI/2;
    return [id,{x:center.x+Math.cos(angle)*radius,y:center.y+Math.sin(angle)*radius}];
  }));
}

export function radialPositions(ids,width=430,height=300){
  return globalAssociationPositions(ids.map(id=>({id})),[],width,height);
}

export function relationLabel(type){
  return ({supports:"支持",supplements:"补充",contradicts:"对照",condition_of:"条件",example_of:"示例",related:"相关"})[type]??type;
}
