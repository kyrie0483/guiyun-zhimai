# Draft Network Skill 1.5.1

支持创建单个节点、连接已有节点、创建单个节点并连接到已有节点。
关系端点只能使用 Harness 提供的真实节点 UUID，不要求孤点；不得生成自环、重复边或虚构端点。
当意图为 `net_suggest_edges` 时，只能输出一个 JSON 对象，并且只能包含 `impactSummary`、
`sourceReferenceIds`、`operations`。三个字段必须出现；没有可靠关系时 `operations` 必须为
`[]`，不得为了满足数量而编造关系。每项必须且只能包含 `sourceNodeId`、`targetNodeId`、
`title`、`note`、`edgeType`、`confidence`、`rationale`；UUID 必须来自目录且两端不同，
`note` 是字符串或 null，`edgeType` 只能为 normal 或 emphasized，`confidence` 是 0～1 数字。
对每个待整合节点通常建议 3～5 条指向不同目标的可靠关系，并按相关性由高到低排列；这不是最低数量
要求，确实缺乏相关性时可以少于 3 条或返回空数组，禁止为了凑数生成牵强关系。
创建节点使用 conversation_to_network，并且只能输出一个 RFC 8259 JSON 对象，禁止代码围栏、解释、
注释、尾逗号和前后缀。对象必须且只能包含 `title`、`note`、`impactSummary`、
`sourceReferenceIds`、`connections`，五个字段全部必填。前三项是非空字符串；
`sourceReferenceIds` 无可靠来源时为 `[]`。仅创建节点时 `connections` 必须为空数组；用户要求
同时连接时，每项必须且只能包含 `targetNodeId`、`title`、`note`、`edgeType`，其中
`targetNodeId` 逐字复制目录 UUID，`note` 是字符串或 null，`edgeType` 只能为 normal 或
emphasized。无法唯一确定目标时返回空数组，不得猜测。
新节点和全部连接作为一个整体审批，在同一个事务内写入。已有节点间连边使用 net_suggest_edges，用户可逐条勾选。
用户指定目标时遵守指定目标；没有唯一匹配时不得猜测。自动连接应基于资料中的关联，不得编造事实。
当意图为 `net_summarize` 时，只能输出一个 JSON 对象，并且必须且只能包含非空字符串 `note`、
非空字符串 `impactSummary` 和数组 `sourceReferenceIds`；无可靠来源时数组必须为 `[]`。
`net_summarize_node` 使用同一精确 JSON 契约，只能总结节点目录中标记为 `[总结目标]` 的节点及用户
指定的总结范围，不得把其他节点的事实归给目标节点，也不得输出目标 ID 或 revision。
`net_summarize_edge` 使用同一精确 JSON 契约，只能总结关系目录中标记为 `[总结目标]` 的关系和两个
真实端点，不得臆造因果、方向、强度或未提供事实，也不得输出目标 ID 或 revision。
摘要任务只更新已指定网络、节点或边的说明。网络 ID 和期望修订号由服务端注入，模型不得决定。
任何写入均先生成草案，用户审查确认后才执行；审批结果和完整草案保留在对话中。

输出前静默执行三级自检：先确认意图对应的唯一契约，再核对端点/目标/来源均来自 Harness 白名单，最后
核对字段集合、类型、枚举、UUID、JSON 转义和首尾字符。收到格式纠错请求时从头重写一个完整对象；不得
解释错误、返回 JSON Patch、只补局部字段或提供多个版本。无法确定关系端点时宁可返回空 operations 或
connections，也不能用名称、占位符或新造 UUID 代替。
