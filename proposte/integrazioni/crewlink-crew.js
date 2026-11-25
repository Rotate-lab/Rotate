/* Rotate · crew list bridge (TEMPLATE: calibrate SEL/RANK against the real CrewLink crew-list page before shipping).
   Run on the CrewLink page that shows the crew of one or more duties. Copies ONLY rank + name per flight. */
(()=>{if(location.hostname!="crewlink.ita-airways.com"){alert("Rotate: open the crew list in CrewLink first.");return}
const RANK=/^(CMD|CPT|CP|FO|SFO|SO|FE|RP|CSD|PU|PS|CC|CA|FA|AV|AS|ASS|SP|CM\d|INS|TRI|TRE|LTC)$/i;
const MON={Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12},p2=n=>String(n).padStart(2,"0");
const docs=[document].concat([...document.querySelectorAll("iframe,frame")].map(f=>{try{return f.contentDocument}catch(e){return null}}).filter(Boolean));
const items=[];
docs.forEach(d=>d.querySelectorAll("table").forEach(tb=>{
 /* flight + date: nearest preceding text like "AZ 608 27Nov26" (legacy CrewLink) or "AZ608 · 2026-11-27" */
 let ctx="",el=tb;for(let i=0;i<6&&el&&!/\b[A-Z]{2}\s?\d{1,4}\b/.test(ctx);i++){el=el.previousElementSibling||el.parentElement;ctx=(el&&el.textContent||"")+" "+ctx}
 ctx+=" "+(tb.querySelector("caption,thead")||{textContent:""}).textContent;
 const fm=ctx.match(/\b(AZ|ITY|DH\/AZ)\s?(\d{1,4})\b/),dm=ctx.match(/\b(\d{2})(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(\d{2})\b/)||ctx.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
 if(!fm||!dm)return;
 const d=dm[2]in MON?"20"+dm[3]+"-"+p2(MON[dm[2]])+"-"+dm[1]:dm[1]+"-"+dm[2]+"-"+dm[3];
 const crew=[];tb.querySelectorAll("tr").forEach(tr=>{const c=[...tr.cells].map(x=>x.textContent.replace(/\s+/g," ").trim());const ri=c.findIndex(x=>RANK.test(x));if(ri<0)return;
  const nm=c.find((x,i)=>i!=ri&&/^[A-ZÀ-Ý' -]{2,}(,|\s)\s*[A-Za-zÀ-ÿ' -]{2,}$/.test(x)&&!/\d/.test(x));if(nm)crew.push({r:c[ri].toUpperCase(),n:nm.replace(/\s*,\s*/," ")})});
 if(crew.length)items.push({d,fn:fm[1].replace("DH/","")+" "+fm[2],crew})}));
if(!items.length){alert("Rotate: no crew list recognised on this page.");return}
const s="ROTATE1 "+JSON.stringify({v:1,t:"crew",at:Date.now(),items});
navigator.clipboard.writeText(s).then(()=>alert("Rotate: crew of "+items.length+" flight(s) copied. Open Rotate › “Paste from CrewLink”."),()=>prompt("Copy this, then paste in Rotate:",s));
})();
