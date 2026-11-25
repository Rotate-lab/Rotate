/* NOTAM (Rotate server → FAA NMS): those valid inside the takeoff / landing window first, closures and outages on top */
// [Q-code subject (letters 2-3), key, EN, IT, weight]  ICAO Doc 8126 / PANS-ABC Q-code subjects
const BRNQ=[[/^MR/,"rwy","Runway","Pista",90],[/^I[CDGILMOSTUWXY]/,"ils","ILS / landing aids","ILS / assistenze all'atterraggio",85],[/^(N[ABDLMNTVX]|G[AW])/,"nav","Navaids / GNSS","Radioassistenze / GNSS",70],[/^P[ADHIKLMNOPRTUX]/,"pro","Procedures","Procedure",60],[/^L/,"lgt","Lighting","Luci",55],[/^(MX|MA|MN|MS|MT|MU|MW|MY|MK|MD|MB|MC|MG|MH|MM|MO|MP)/,"twy","Taxiway / apron","Taxiway / piazzale",45],[/^C/,"com","COM / radar","COM / radar",45],[/^S/,"ats","ATS / ATIS","Servizi ATS / ATIS",40],[/^F/,"fac","Aerodrome services","Servizi aeroportuali",35],[/^(A|R|W)/,"asp","Airspace / warnings","Spazio aereo / avvisi",30],[/^O/,"obs","Obstacles","Ostacoli",20]];
const BRNC={LC:["Closed","Chiuso"],AS:["Unserviceable","Fuori servizio"],AU:["Not available","Non disponibile"],AW:["Withdrawn","Ritirato"],LT:["Limited","Limitato"],CH:["Changed","Modificato"],AH:["Hours changed","Orari modificati"]};
// FAA domestic NOTAMs may lack a Q-code: guess subject and condition from the text keywords
function brNq(t){t=" "+String(t||"").toUpperCase()+" ";const s=/\b(ILS|LOC|LLZ|GP|GS)\b/.test(t)?"IC":/\bRWY\b/.test(t)&&!/\bTWY\b/.test(t)?"MR":/\b(VOR|DME|NDB|TACAN|VORTAC|GPS|GNSS)\b/.test(t)?"NA":/\b(IAP|SID|STAR|RNAV|RNP)\b/.test(t)?"PI":/\b(TWY|APRON|RAMP)\b/.test(t)?"MX":/\b(PAPI|ALS|LGT|LIGHTS?)\b/.test(t)?"LX":/\b(OBST|CRANE|TOWER)\b/.test(t)?"OB":"";
 const c=/\bCLSD\b/.test(t)?"LC":/\b(U\/S|UNSERVICEABLE|OTS)\b/.test(t)?"AS":/\bUNAVBL\b/.test(t)?"AU":"XX";return s?s+c:""}
function brNcat(q,txt){q=String(q||"").toUpperCase().replace(/^Q/,"");if(!/^[A-Z]{4}$/.test(q)||q.startsWith("XX"))q=brNq(txt)||q;const s=q.slice(0,2),c=q.slice(2,4),R=BRNQ.find(x=>x[0].test(s)),cl=BRNC[c];
 const k=R?R[1]:"oth",crit=!!cl&&/^(LC|AS|AU|AW)$/.test(c)&&/^(rwy|ils|nav|pro|lgt)$/.test(k);
 return{k,l:R?tt(R[2],R[3]):tt("Other","Altro"),w:(R?R[4]:10)+(crit?100:cl&&c=="LT"?20:0),crit,cl:cl?tt(cl[0],cl[1]):""}}
// small plain-language aid, ICAO Doc 8400 abbreviations (the raw text always stays visible)
const BRNA={CLSD:"closed","U/S":"unserviceable",AVBL:"available",UNAVBL:"unavailable",WIP:"work in progress",RWY:"runway",TWY:"taxiway",THR:"threshold",DTHR:"displaced threshold",APCH:"approach",DEP:"departure",ARR:"arrival",RTE:"route",ACFT:"aircraft",OPR:"operating",OPS:"operations",EXC:"except",BTN:"between",MAINT:"maintenance",LGT:"lights",ALS:"approach lighting",PAPI:"PAPI",SFC:"surface",AGL:"above ground",AMSL:"above MSL",ELEV:"elevation",OBST:"obstacle",TEMPO:"temporarily",FLW:"following",INFO:"information",REF:"reference",DLY:"daily",SR:"sunrise",SS:"sunset",HR:"hours",TIL:"until",ACT:"active",SER:"service",FREQ:"frequency",PROC:"procedure",GP:"glide path",LLZ:"localizer",CAT:"category",TORA:"TORA",LDA:"LDA",ASDA:"ASDA",TODA:"TODA",PPR:"prior permission required",RESTR:"restricted",PSN:"position",NML:"normal",CTN:"caution"};
function brNdec(t){return String(t||"").replace(/[A-Z/]{2,}/g,w=>BRNA[w]||w)}
const brFL=n=>String(n).padStart(3,"0");
function brNotHtml(iata,ap,dep,w0,w1,L,err,stale){
 const now=Date.now(),inW=n=>n.start!=null&&n.start<w1&&(n.end==null||n.end>w0);
 const A=L.map(n=>Object.assign({},n,{c:brNcat(n.q,n.text)})).sort((a,b)=>b.c.w-a.c.w||(a.start||0)-(b.start||0)),hit=A.filter(inW),oth=A.filter(n=>!inW(n));
 const item=n=>{const dec=brNdec(n.text);return'<div class="bnt'+(n.c.crit?" crit":"")+'"><div class="bnth"><span class="bntc">'+esc(n.c.l)+'</span>'+(n.c.cl?'<span class="'+(n.c.crit?"brz":"bntk")+'">'+esc(n.c.cl)+'</span>':"")
  +(n.iss&&now-n.iss<864e5?'<span class="bntn">'+tt("NEW","NUOVO")+'</span>':"")+'<small>'+esc(n.id)+'</small></div>'
  +'<div class="bntx">'+esc(n.text||n.raw)+'</div>'
  +(dec!=n.text?'<div class="bntd">'+esc(dec)+'</div>':"")
  +'<small class="bntv">'+(n.start!=null?brDZ(n.start):"?")+' → '+(n.end==null?(n.perm?"PERM":"?"):brDZ(n.end)+(n.est?" EST":""))
  +(n.sched?' · '+esc(n.sched):"")+(n.lo!=null&&n.hi!=null&&!(n.lo==0&&n.hi==999)?' · FL'+brFL(n.lo)+'–'+brFL(n.hi):"")+'</small>'
  +(n.raw?'<details class="bntr"><summary>'+tt("Original text","Testo originale")+'</summary><pre>'+esc(n.raw)+'</pre></details>':"")+'</div>'};
 const crit=hit.filter(n=>n.c.crit),sum={};crit.forEach(n=>{const k=n.c.l+" "+n.c.cl.toLowerCase();sum[k]=(sum[k]||0)+1});
 let h='<div class="brd'+(crit.length?" warn":"")+'"><div class="brdr"><span class="brrole">'+(dep?tt("TAKEOFF","DECOLLO"):tt("LANDING","ATTERRAGGIO"))+'</span><span class="brin">'+hit.length+' / '+A.length+' NOTAM</span></div>'
  +'<div class="brdh"><b>'+esc(ap)+'</b><span>'+esc(cityN(iata))+'</span></div>'
  +'<div class="brwin"><span>'+tt("Valid in window","Validi nella finestra")+'</span><b>'+brD(w0)+' '+brZ(w0)+' – '+brZ(w1)+'</b></div>';
 if(err&&!A.length)return h+'<p class="brnc">'+tt("NOTAM not available right now","NOTAM non disponibili adesso")+'</p></div>';
 if(stale)h+='<p class="brnc">'+tt("Server copy from ","Copia del server delle ")+brZ(stale)+' — '+tt("the NOTAM source is not answering","la fonte NOTAM non risponde")+'</p>';
 if(Object.keys(sum).length)h+='<div class="brsum">'+Object.entries(sum).map(([k,v])=>'<span class="brz">'+esc(k)+(v>1?" ×"+v:"")+'</span>').join("")+'</div>';
 h+=hit.length?hit.map(item).join(""):'<p class="brn">'+tt("No NOTAM valid in the window.","Nessun NOTAM valido nella finestra.")+'</p>';
 if(oth.length)h+='<details><summary>'+tt("Other active NOTAM","Altri NOTAM attivi")+' ('+oth.length+')</summary>'+oth.map(item).join("")+'</details>';
 return h+'</div>'}
async function brNotam(f,d0,a0,ia,ib){const box=$("#brNot");if(!box||!WXS)return;const W=[[f.from,ia,1,d0],[f.to,ib,0,a0]].filter(x=>x[1]);if(!W.length)return;
 box.innerHTML='<p class="brn">'+tt("Loading NOTAM…","Carico i NOTAM…")+'</p>';
 try{const j=await brGet(WXS+"/notam?ids="+[...new Set(W.map(x=>x[1]))].join(","));if(!document.body.contains(box))return;
  box.innerHTML=W.map(([iata,ap,dep,t])=>brNotHtml(iata,ap,dep,t-36e5,t+36e5,(j.notams||[]).filter(n=>n.loc==ap),(j.err||{})[ap],(j.stale||{})[ap])).join("")
   +'<p class="brn">'+tt("Source: FAA NOTAM system via the Rotate server, updated ","Fonte: sistema NOTAM FAA tramite il server di Rotate, aggiornato ")+brZ(j.ts||Date.now())+'. '+tt("Check the official briefing in LIDO.","Verifica il briefing ufficiale in LIDO.")+'</p>'}
 catch(e){if(document.body.contains(box))box.innerHTML='<p class="brn">'+tt("NOTAM not available right now: use the links below.","NOTAM non disponibili adesso: usa i link qui sotto.")+'</p>'}}
