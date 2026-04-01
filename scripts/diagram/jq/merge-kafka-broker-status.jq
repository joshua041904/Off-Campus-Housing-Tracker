# Slurp: [ data-flow-model.json, kafka-status.json ] → merged model with .kafka_cluster.brokers[].health
.[0] as $m | .[1] as $st
| $m
| .kafka_cluster.brokers |= map(
    . as $b
    | (
        if ($st[$b.id] != null) then $st[$b.id]
        elif ($st.brokers != null and ($st.brokers[$b.id] != null)) then $st.brokers[$b.id]
        else null
        end
        | if . == null then ($b.health // "unknown")
          elif type == "string" then .
          elif type == "object" then (.health // "unknown")
          else "unknown" end
      ) as $h
    | $b + {health: $h}
  )
