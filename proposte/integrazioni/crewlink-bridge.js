// Rotate · CrewLink bridge. Runs INSIDE crewlink.ita-airways.com (bookmarklet or Userscripts), in the pilot's own logged-in session.
// Reads only the pilot's own Individual duty plan PDF(s) (the same file as the manual flow) and puts them on the clipboard for Rotate.
(()=>{const H="crewlink.ita-airways.com";if(location.hostname!=H){alert("Rotate: open CrewLink ("+H+"), log in, then tap the bookmark again.");return}
const M=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],p2=n=>String(n).padStart(2,"0"),cl=d=>p2(d.getDate())+M[d.getMonth()]+String(d.getFullYear()).slice(2);
const t=new Date(),mo=(t.getDate()<=7?[-1]:[]).concat([0,1]);/* previous month too in the first week: actual block times for the logbook */
const per=mo.map(i=>[new Date(t.getFullYear(),t.getMonth()+i,1),new Date(t.getFullYear(),t.getMonth()+i+1,0)]);
const url=([a,b])=>"/crewlink/clApp?"+new URLSearchParams({crewlinkService:"individualDutyPlan",crewlinkOperation:"makeReport",buddyName:"",beginDate:cl(a),endDate:cl(b)});
const isPdf=b=>b.byteLength>4&&new TextDecoder().decode(new Uint8Array(b,0,5))=="%PDF-";
async function pdf(u){const r=await fetch(u,{credentials:"include"});if(!r.ok)throw new Error("HTTP "+r.status);let b=await r.arrayBuffer();
 if(!isPdf(b)){const d=new DOMParser().parseFromString(new TextDecoder().decode(b),"text/html"),e=d.querySelector("embed[src],iframe[src],object[data],a[href*='.pdf'],a[href*='makeReport']"),s=e&&(e.getAttribute("src")||e.getAttribute("data")||e.getAttribute("href"));
  if(!s)throw new Error(d.querySelector("input[type=password]")||/log ?in|sign ?in|password/i.test(d.body?d.body.textContent:"")?"login":"no PDF");
  const r2=await fetch(new URL(s,r.url),{credentials:"include"});b=await r2.arrayBuffer();if(!isPdf(b))throw new Error("no PDF")}
 return b}
const b64=b=>{let s="";const u=new Uint8Array(b);for(let i=0;i<u.length;i+=32768)s+=String.fromCharCode.apply(null,u.subarray(i,i+32768));return btoa(s)};
const job=(async()=>{const files=[];for(const p of per)files.push({n:cl(p[0])+"-"+cl(p[1])+".pdf",b64:b64(await pdf(url(p)))});return"ROTATE1 "+JSON.stringify({v:1,t:"dp",at:Date.now(),files})})();
const o=document.createElement("div");o.style.cssText="position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;background:#0b1220;color:#fff;font:15px/1.35 -apple-system,system-ui,sans-serif;padding:14px 16px;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.4)";o.textContent="Rotate: reading your duty plan…";document.body.appendChild(o);
const done=(ok,m)=>{o.textContent=m;o.style.background=ok?"#0a7d3b":"#b3261e";setTimeout(()=>o.remove(),ok?7000:10000)};
const fail=e=>done(0,"Rotate: "+(e&&e.message=="login"?"log in to CrewLink first, then tap the bookmark again.":"could not read the duty plan ("+(e&&e.message||e)+")."));
const okMsg="✓ Copied for Rotate. Open Rotate › Duty plan › “Paste from CrewLink”.";
const button=s=>{o.textContent="";const b=document.createElement("button");b.textContent="Copy for Rotate";b.style.cssText="font:inherit;font-weight:600;padding:10px 16px;border-radius:10px;border:0;background:#1a73e8;color:#fff";b.onclick=()=>navigator.clipboard.writeText(s).then(()=>done(1,okMsg),fail);o.appendChild(b)};
/* Safari: clipboard.write() must start inside the tap; a ClipboardItem may hold a Promise that resolves after the downloads */
try{navigator.clipboard.write([new ClipboardItem({"text/plain":job.then(s=>new Blob([s],{type:"text/plain"}))})]).then(()=>done(1,okMsg),()=>job.then(button,fail))}catch(e){job.then(button,fail)}
})();
