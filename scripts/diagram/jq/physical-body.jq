# Merged schema JSON (tables, foreign_keys, optional table_stats) → DOT body.
def nid($s; $n): ($s + "_" + $n) | gsub("[^a-zA-Z0-9_]"; "_");

def labcols($cols):
  if ($cols | length) == 0 then ""
  else ($cols[0:16] | map("\(.name) : \(.type)") | join("\\l"))
  end;

# Heat: row count + seq_scan vs idx_scan ratio (observability overlay).
def heat($root; $sch; $tbl):
  (($root.table_stats // []) | map(select(.schema == $sch and .name == $tbl)) | .[0]) as $st
  | if $st == null then "#eceff1"
    else
      ($st.n_live_tup // 0) as $n
      | ($st.seq_scan // 0) as $sq
      | ($st.idx_scan // 0) as $ix
      | (($sq + 0.001) / ($sq + $ix + 0.001)) as $rat
      | if $n < 50 and ($sq + $ix) < 20 then "#e8f5e9"
        elif $rat > 0.75 and $n > 200 then "#ffcdd2"
        elif $n > 100000 then "#ffcc80"
        elif $n > 5000 then "#fff59d"
        elif $n > 200 then "#e1f5fe"
        else "#f1f8e9"
        end
    end;

. as $root
| ($root.tables | group_by(.schema)[] | . as $grp | $grp[0].schema as $sch
    | ("cluster_" + ($sch | gsub("[^a-zA-Z0-9_]"; "_"))) as $cid
    | "  subgraph \($cid) {",
      "    style=filled;",
      "    color=lightgrey;",
      "    label=\"Schema: \($sch)\";",
      ($grp[] | "    \"" + nid(.schema; .name) + "\" [label=\"{" + .name + "|" + labcols(.columns) + "}\", style=filled, fillcolor=\"" + heat($root; .schema; .name) + "\"];"),
      "  }",
      ""
  ),
  ($root.foreign_keys[]?
    | "  \""
    + nid(.from_schema; .from_table)
    + "\" -> \""
    + nid(.to_schema; .to_table)
    + "\" [label=\""
    + (.name | gsub("\""; "'"))
    + "\"];"
  )
