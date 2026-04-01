# Merged data-flow-model.json → lines inside digraph { } (styled nodes + Kafka broker hexagons).
def nattr($id):
  if $id == "postgres_fleet" then "shape=cylinder, style=filled, fillcolor=\"#e6ccff\""
  elif $id == "gateway" then "shape=box, style=\"rounded,filled\", fillcolor=\"#99ccff\""
  elif $id == "caddy" then "shape=ellipse, style=filled, fillcolor=\"#cce6ff\""
  elif $id == "event_layer" then "shape=box, style=\"rounded,filled\", fillcolor=\"#c8e6c9\""
  else "shape=box, style=\"rounded,filled\", fillcolor=\"#ccffcc\""
  end;

def kafka_nattr($b):
  ($b.health // "unknown") as $h
  | if $h == "stable" then "shape=hexagon, style=filled, fillcolor=\"#a5d6a7\", color=\"#2e7d32\""
    elif $h == "election_heavy" then "shape=hexagon, style=filled, fillcolor=\"#ffb74d\", color=\"#e65100\""
    elif $h == "flapping" then "shape=hexagon, style=filled, fillcolor=\"#e57373\", color=\"#b71c1c\""
    else "shape=hexagon, style=filled, fillcolor=\"#ffcc99\", color=\"#795548\""
    end;

.labels as $L
| (.kafka_cluster.brokers // []) as $kbs
| (.clusters[]
   | if .id == "data" and ($kbs | length) > 0 then
      "  subgraph cluster_data {",
      "    label=\"\(.label)\";",
      "    style=rounded;",
      (.nodes[] | "    \(.) [label=\"\($L[.] // .)\", \(nattr(.))];"),
      "    subgraph cluster_kafka_brokers {",
      "      label=\"Kafka (KRaft)\";",
      "      style=filled;",
      "      fillcolor=\"#fff8e1\";",
      "      color=\"#f9a825\";",
      "      { rank=same;",
      ($kbs[] | (.health // "unknown") as $hh | "        \(.id) [label=\"\($L[.id] // .label)\\n\($hh)\", \(kafka_nattr(.))];"),
      "      }",
      "    }",
      "  }"
    else
      "  subgraph cluster_\(.id) {",
      "    label=\"\(.label)\";",
      "    style=rounded;",
      (.nodes[] | "    \(.) [label=\"\($L[.] // .)\", \(nattr(.))];"),
      "  }"
    end
  ),
  (.edges[]
   | (if (.style // "solid") == "dashed" then "style=dashed, " else "" end) as $st
   | "  \(.from) -> \(.to) [\($st)label=\"\(.label)\"];"
  )
