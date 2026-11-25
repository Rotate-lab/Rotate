/* ===== Reload from CrewLink: clipboard bridge (Safari tab → Home Screen app, which have separate storage on iOS) ===== */
const CLB="ROTATE1 ",CLB_MAX=6e6;
async function clbImport(s){s=String(s||"").trim();if(!s.startsWith(CLB)||s.length>CLB_MAX)return 0;let P;try{P=JSON.parse(s.slice(CLB.length))}catch(e){return 0}
 if(!P||P.v!==1)return 0;
 if(P.t=="dp"){let ok=0,dd=0;const fs=(Array.isArray(P.files)?P.files:[]).slice(0,4);
  for(const f of fs){try{const u=Uint8Array.from(atob(String(f.b64||"")),c=>c.charCodeAt(0)),ls=await pdfLines(u.buffer),n=ingest(parseLines(ls),String(f.n||"CrewLink.pdf"),ls);if(n){ok++;dd+=n}}catch(e){}}
  if(ok){toast(tt("Duty plan reloaded","Duty plan ricaricato"),ok+"/"+fs.length+" PDF · "+dd+" "+tt("days","giorni"));if(typeof syncDirty=="function")syncDirty()}return ok}
 if(P.t=="crew")return crewIngest(P);
 return 0}
async function clbPaste(){let s="";try{s=await navigator.clipboard.readText()}catch(e){toast(tt("Paste not allowed","Incolla non consentito"),tt("Tap “Paste” in the bubble that appears","Tocca “Incolla” nel fumetto che compare"));return}
 const n=await clbImport(s);if(!n){toast(tt("Nothing from CrewLink in the clipboard","Negli appunti non c'è niente da CrewLink"),tt("Run the Rotate bookmark on CrewLink first","Prima usa il segnalibro Rotate su CrewLink"));return}
 try{await navigator.clipboard.writeText(" ")}catch(e){} /* do not leave roster / crew data on the clipboard */
 try{localStorage.removeItem("rot_clw")}catch(e){}clbBar()}
function clbStart(){try{localStorage.setItem("rot_clw",String(Date.now()))}catch(e){}}  // call when "Reload from CrewLink" opens Safari
function clbBar(){let w=0;try{w=+localStorage.getItem("rot_clw")||0}catch(e){}const on=w&&Date.now()-w<20*6e4;let b=document.getElementById("clbBar");
 if(!on){if(b)b.remove();return}
 if(!b){b=document.createElement("div");b.id="clbBar";b.className="clbb";b.innerHTML='<span>'+tt("Back from CrewLink?","Di ritorno da CrewLink?")+'</span><button type="button" id="clbP">'+tt("Paste from CrewLink","Incolla da CrewLink")+'</button><button type="button" id="clbX" aria-label="Close">×</button>';document.body.appendChild(b);
  $("#clbP").onclick=clbPaste;$("#clbX").onclick=()=>{try{localStorage.removeItem("rot_clw")}catch(e){}clbBar()}}}
document.addEventListener("visibilitychange",()=>{if(!document.hidden)clbBar()});

/* ===== Crew per flight (opt-in, local only, purged 30 days after the flight) ===== */
const CREW_KEEP=30*864e5;
function crewOn(){try{return localStorage.getItem("rot_crew")=="1"}catch(e){return false}}
function crewIngest(P){if(!crewOn()){toast(tt("Crew lists are off","Liste equipaggio disattivate"),tt("Turn them on in Settings › Rotate App","Attivale in Impostazioni › Rotate App"));return 0}
 let n=0;(Array.isArray(P.items)?P.items:[]).forEach(it=>{const D=days[it.d];if(!D)return;const fn=String(it.fn||"").replace(/\s+/g,"").toUpperCase();
  const f=(D.ev||[]).find(e=>e.t=="fl"&&e.fn.replace(/\s+/g,"").toUpperCase()==fn);if(!f)return;
  f.crew=(Array.isArray(it.crew)?it.crew:[]).slice(0,24).map(c=>({r:String(c.r||"").slice(0,6),n:String(c.n||"").slice(0,48)})).filter(c=>c.n);f.crewAt=Date.now();n++});
 if(n){save();toast(tt("Crew list saved","Lista equipaggio salvata"),n+" "+tt("flights","voli"))}return n}
function crewPurge(){const lim=Date.now()-CREW_KEEP;let ch=0;Object.keys(days).forEach(k=>{if(new Date(k+"T00:00:00Z").getTime()>=lim)return;(days[k].ev||[]).forEach(e=>{if(e.crew){delete e.crew;delete e.crewAt;ch=1}})});if(ch)save()}
// briefing / day detail: '<div class="brg"><h4>'+tt("Crew","Equipaggio")+'</h4>'+crewHtml(f)+'</div>'
function crewHtml(f){if(!f||!f.crew||!f.crew.length)return"";return'<div class="brd">'+f.crew.map(c=>'<div class="brdp"><b>'+esc(c.r)+'</b><span>'+esc(c.n)+'</span></div>').join("")+'<small class="brdt">'+tt("From CrewLink, ","Da CrewLink, ")+fmtAt(f.crewAt)+'</small></div>'}
