# unified-logical-er.json → DOT body (inside digraph).
(
  .clusters[] as $c
  | "  subgraph cluster_\($c.id) {",
    "    label=\"\($c.label)\";",
    "    style=filled;",
    "    fillcolor=\"\($c.fillcolor)\";",
    "    color=\"#666666\";",
    ($c.entities[] | "    \(.id) [label=\"\(.label)\", shape=record, style=filled, fillcolor=\"#ffffff\", color=\"#333333\"];"),
    "  }",
    ""
),
(.edges[]?
  | (.kind // "fk") as $k
  | (if $k == "async" then "dashed"
     elif $k == "projection" then "dotted"
     else "solid" end) as $st
  | "  \(.from) -> \(.to) [style=\($st), label=\"\((.label // "") | gsub("\""; "\\\""))\"];"
)
