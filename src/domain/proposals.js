export function createRelationProposal({ sourceNodeId, targetNodeId, relationType, explanation }) {
  if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) throw new Error("关系端点无效。");
  return {
    id: crypto.randomUUID(),
    kind: "create-relation",
    payload: { explanation: explanation.trim(), relationType, sourceNodeId, targetNodeId },
    revision: 1,
    status: "pending"
  };
}

export function applyProposal(state, proposalId, expectedRevision = 1) {
  const proposal = state.proposals.find((item) => item.id === proposalId);
  if (!proposal || proposal.status !== "pending") throw new Error("草案不存在或已处理。");
  if (proposal.revision !== expectedRevision) throw new Error("草案版本已经变化。");
  if (proposal.kind !== "create-relation") throw new Error("草案类型不受支持。");
  const edge = { id: crypto.randomUUID(), ...proposal.payload, createdAt: new Date().toISOString() };
  return {
    ...state,
    edges: [...state.edges, edge],
    proposals: state.proposals.map((item) => item.id === proposalId ? { ...item, revision: item.revision + 1, status: "applied" } : item)
  };
}

export function rejectProposal(state, proposalId) {
  return {
    ...state,
    proposals: state.proposals.map((item) => item.id === proposalId && item.status === "pending" ? { ...item, revision: item.revision + 1, status: "rejected" } : item)
  };
}
