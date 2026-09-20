#!/bin/bash
# Every case, 3 runs each, medians. Usage: bench/run.sh [rows]
cd "$(dirname "$0")"
for c in biToday biParseOnce engine engineText hand augustBiToday augustEngine augustHand; do
  for i in 1 2 3; do node --expose-gc bench.mjs $c ${1:-1000000}; done
done | node -e '
const L=require("fs").readFileSync(0,"utf8").trim().split("\n").map(JSON.parse).filter(r=>!r.skipped);const g={}
for(const r of L)(g[r.case]??=[]).push(r)
for(const[c,rs]of Object.entries(g)){rs.sort((a,b)=>a.ms-b.ms);const m=rs[Math.floor(rs.length/2)]
console.log(c.padEnd(14),String(m.ms).padStart(6)+" ms",String(m.rowsPerSec).padStart(10)+" rows/s","gc "+String(m.gcCount).padStart(5),"peak "+m.peakRssMB+" MB ",m.result)}'
