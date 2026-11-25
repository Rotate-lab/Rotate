/* Rotate · CrewLink endpoint probe (developer only, run once on the NEW web UI .../crew-clws-webui/index.html#/).
   Records which JSON endpoints the SPA calls and the SHAPE of the answers (keys and types, never values),
   so the bridge can later call the same endpoints. Navigate to Roster / Crew list after running it, then tap it again to copy the report. */
(()=>{const W=window;if(W.__rotProbe){navigator.clipboard.writeText(JSON.stringify(W.__rotProbe,null,1)).then(()=>alert("Rotate probe: "+W.__rotProbe.length+" calls copied"));return}
const log=W.__rotProbe=[];
const shape=(v,d)=>d>3?typeof v:Array.isArray(v)?[v.length?shape(v[0],d+1):"empty"]:v&&typeof v=="object"?Object.fromEntries(Object.keys(v).slice(0,40).map(k=>[k,shape(v[k],d+1)])):typeof v;
const rec=(m,u,st,txt,hdr)=>{let j=null;try{j=shape(JSON.parse(txt),0)}catch(e){}log.push({m,u:String(u).replace(/([?&](?:token|access_token|code)=)[^&]+/gi,"$1…"),st,auth:!!hdr,shape:j})};
const F=W.fetch;W.fetch=async(i,o)=>{const r=await F(i,o);try{const c=r.clone();c.text().then(t=>rec((o&&o.method)||"GET",typeof i=="string"?i:i.url,r.status,t,o&&o.headers&&(o.headers.Authorization||o.headers.authorization||(o.headers.get&&o.headers.get("Authorization")))))}catch(e){}return r};
const X=W.XMLHttpRequest.prototype,op=X.open,sh=X.setRequestHeader,se=X.send;
X.open=function(m,u){this.__r={m,u};return op.apply(this,arguments)};X.setRequestHeader=function(k,v){if(/^authorization$/i.test(k))this.__a=1;return sh.apply(this,arguments)};
X.send=function(){this.addEventListener("load",()=>rec(this.__r.m,this.__r.u,this.status,this.responseText,this.__a));return se.apply(this,arguments)};
alert("Rotate probe on. Open your roster and a crew list, then tap the bookmark again.")})();
