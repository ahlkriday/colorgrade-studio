import { useState, useRef, useEffect, useCallback } from "react";

const VERTEX_SHADER = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  varying vec2 v_texCoord;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
`;

const FRAGMENT_SHADER = `
  precision mediump float;
  uniform sampler2D u_image;
  uniform vec3 u_lift, u_gamma, u_gain;
  uniform float u_saturation, u_exposure, u_contrast, u_temperature, u_tint;
  uniform float u_vignette, u_grain, u_time;
  uniform vec3 u_shadowTint, u_highlightTint;
  uniform float u_shadowStrength, u_highlightStrength;
  uniform float u_flashStrength, u_flashThreshold, u_backgroundCrush;
  varying vec2 v_texCoord;

  vec3 rgbToHsl(vec3 c) {
    float mx=max(c.r,max(c.g,c.b)),mn=min(c.r,min(c.g,c.b)),l=(mx+mn)/2.0,s=0.0,h=0.0;
    if(mx!=mn){float d=mx-mn;s=l>0.5?d/(2.0-mx-mn):d/(mx+mn);
      if(mx==c.r)h=(c.g-c.b)/d+(c.g<c.b?6.0:0.0);
      else if(mx==c.g)h=(c.b-c.r)/d+2.0;else h=(c.r-c.g)/d+4.0;h/=6.0;}
    return vec3(h,s,l);
  }
  float h2r(float p,float q,float t){
    if(t<0.0)t+=1.0;if(t>1.0)t-=1.0;
    if(t<1.0/6.0)return p+(q-p)*6.0*t;if(t<0.5)return q;
    if(t<2.0/3.0)return p+(q-p)*(2.0/3.0-t)*6.0;return p;
  }
  vec3 hslToRgb(vec3 hsl){
    float h=hsl.x,s=hsl.y,l=hsl.z;if(s==0.0)return vec3(l);
    float q=l<0.5?l*(1.0+s):l+s-l*s,p=2.0*l-q;
    return vec3(h2r(p,q,h+1.0/3.0),h2r(p,q,h),h2r(p,q,h-1.0/3.0));
  }
  float rand(vec2 co){return fract(sin(dot(co,vec2(12.9898,78.233)))*43758.5453);}

  void main(){
    vec4 tex=texture2D(u_image,v_texCoord);
    vec3 color=tex.rgb;

    if(u_flashStrength>0.0){
      float lm=dot(color,vec3(0.2126,0.7152,0.0722));
      float mask=smoothstep(u_flashThreshold-0.15,u_flashThreshold+0.2,lm);
      color*=1.0-u_backgroundCrush*(1.0-mask);
      color.r*=1.0-u_flashStrength*0.08;color.b*=1.0+u_flashStrength*0.06;
      vec3 fh=rgbToHsl(color);fh.y*=1.0-u_flashStrength*0.25;color=hslToRgb(fh);
    }

    color*=pow(2.0,u_exposure);
    color.r+=u_temperature*0.1;color.b-=u_temperature*0.1;color.g+=u_tint*0.05;
    color=clamp((color-0.5)*u_contrast+0.5,0.0,1.0);
    color=clamp(pow(max(color*u_gain+u_lift,0.0),1.0/max(u_gamma,vec3(0.001))),0.0,1.0);

    float luma=dot(color,vec3(0.2126,0.7152,0.0722));
    color=mix(color,u_shadowTint,clamp(1.0-luma*3.5,0.0,1.0)*u_shadowStrength);
    color=mix(color,u_highlightTint,clamp((luma-0.55)*3.0,0.0,1.0)*u_highlightStrength);

    vec3 hsl=rgbToHsl(color);hsl.y=clamp(hsl.y*u_saturation,0.0,1.0);color=hslToRgb(hsl);

    vec2 uv=v_texCoord-0.5;
    color*=clamp(1.0-dot(uv,uv)*u_vignette*3.0,0.0,1.0);
    if(u_grain>0.0)color+=(rand(v_texCoord+vec2(u_time*0.001))*2.0-1.0)*u_grain*0.08;

    gl_FragColor=vec4(clamp(color,0.0,1.0),tex.a);
  }
`;

const X={shadowTint:[0,0,0],highlightTint:[1,1,1],shadowStrength:0,highlightStrength:0,flashStrength:0,flashThreshold:0.35,backgroundCrush:0};

const PRESETS=[
  {id:"none",name:"Original",icon:"◎",category:"base",description:"No filter applied",
   params:{exposure:0,contrast:1,saturation:1,temperature:0,tint:0,lift:[0,0,0],gamma:[1,1,1],gain:[1,1,1],vignette:0,grain:0,...X}},

  {id:"prequel_flash",name:"Flash",icon:"⚡",category:"prequel",description:"Prequel Flash · Background crushed to black · Cool analog pop",
   params:{exposure:-0.1,contrast:1.22,saturation:0.78,temperature:-0.12,tint:0,
     lift:[-0.01,-0.01,0.01],gamma:[0.97,0.97,1.0],gain:[0.98,0.98,1.02],vignette:0.72,grain:0.28,
     shadowTint:[0.03,0.03,0.07],highlightTint:[0.97,0.97,1.0],shadowStrength:0.35,highlightStrength:0.08,
     flashStrength:1.0,flashThreshold:0.32,backgroundCrush:0.88}},

  {id:"toronto_night",name:"Toronto Night",icon:"◈",category:"royy",description:"Electric blue city · Hot orange practicals · Crushed blacks",
   params:{exposure:-0.45,contrast:1.38,saturation:1.15,temperature:0.1,tint:0,
     lift:[-0.01,-0.01,0.02],gamma:[0.95,0.95,1.05],gain:[1.12,0.95,0.88],vignette:0.65,grain:0.12,
     shadowTint:[0.05,0.07,0.18],highlightTint:[1.0,0.55,0.15],shadowStrength:0.55,highlightStrength:0.2,
     flashStrength:0,flashThreshold:0.35,backgroundCrush:0}},

  {id:"tunnel_fire",name:"Tunnel Fire",icon:"◆",category:"royy",description:"Crushed silhouettes · Blown orange · No shadow detail",
   params:{exposure:-0.5,contrast:1.55,saturation:1.05,temperature:0.65,tint:0.05,
     lift:[-0.02,-0.02,-0.03],gamma:[1.02,0.92,0.82],gain:[1.18,0.88,0.62],vignette:0.7,grain:0.18,
     shadowTint:[0.02,0.01,0.0],highlightTint:[1.0,0.45,0.0],shadowStrength:0.7,highlightStrength:0.35,
     flashStrength:0,flashThreshold:0.35,backgroundCrush:0}},

  {id:"city_drip",name:"City Drip",icon:"◉",category:"royy",description:"Teal shadows · Warm subject · Music video split",
   params:{exposure:-0.3,contrast:1.28,saturation:1.1,temperature:0.05,tint:-0.08,
     lift:[0.0,0.02,0.06],gamma:[0.96,0.97,1.04],gain:[1.08,0.96,0.9],vignette:0.55,grain:0.1,
     shadowTint:[0.04,0.12,0.22],highlightTint:[1.0,0.75,0.45],shadowStrength:0.45,highlightStrength:0.18,
     flashStrength:0,flashThreshold:0.35,backgroundCrush:0}},

  {id:"apple_cinematic",name:"Apple Cinematic",icon:"◇",category:"classic",description:"Warm tones · Lifted blacks · Skin-friendly",
   params:{exposure:0.15,contrast:1.08,saturation:0.82,temperature:0.25,tint:0.05,
     lift:[0.04,0.02,0.01],gamma:[0.96,0.98,1.02],gain:[1.05,1.0,0.92],vignette:0.3,grain:0.15,
     shadowTint:[0.08,0.05,0.03],highlightTint:[1.0,0.95,0.88],shadowStrength:0.15,highlightStrength:0.08,
     flashStrength:0,flashThreshold:0.35,backgroundCrush:0}},

  {id:"old_money",name:"Old Money",icon:"◑",category:"classic",description:"Muted greens · Warm skin · Film grain",
   params:{exposure:-0.1,contrast:1.05,saturation:0.65,temperature:0.15,tint:-0.05,
     lift:[0.03,0.03,0.02],gamma:[1.0,0.97,0.94],gain:[1.02,0.98,0.88],vignette:0.45,grain:0.35,
     shadowTint:[0.06,0.05,0.03],highlightTint:[1.0,0.97,0.9],shadowStrength:0.12,highlightStrength:0.06,
     flashStrength:0,flashThreshold:0.35,backgroundCrush:0}},

  {id:"moody_cinematic",name:"Moody Cinema",icon:"◐",category:"classic",description:"Deep shadows · Cool tones · Desaturated",
   params:{exposure:-0.25,contrast:1.18,saturation:0.72,temperature:-0.3,tint:0,
     lift:[0.0,0.01,0.03],gamma:[0.93,0.95,1.0],gain:[0.92,0.96,1.08],vignette:0.6,grain:0.2,
     shadowTint:[0.02,0.03,0.08],highlightTint:[0.9,0.95,1.0],shadowStrength:0.2,highlightStrength:0.1,
     flashStrength:0,flashThreshold:0.35,backgroundCrush:0}},

  {id:"vintage_film",name:"Vintage Film",icon:"◫",category:"classic",description:"Teal & orange · Film grain · Analog",
   params:{exposure:-0.05,contrast:1.1,saturation:0.9,temperature:0.2,tint:-0.1,
     lift:[0.02,0.04,0.05],gamma:[1.0,0.96,0.9],gain:[1.06,0.98,0.85],vignette:0.5,grain:0.5,
     shadowTint:[0.04,0.1,0.12],highlightTint:[1.0,0.82,0.55],shadowStrength:0.3,highlightStrength:0.2,
     flashStrength:0,flashThreshold:0.35,backgroundCrush:0}},
];

const CATEGORIES=[{id:"all",label:"All"},{id:"prequel",label:"Prequel"},{id:"royy",label:"royyschneider"},{id:"classic",label:"Classic"}];

function createWebGLEngine(canvas){
  const gl=canvas.getContext("webgl",{preserveDrawingBuffer:true,alpha:true});
  if(!gl)return null;
  function cs(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);return s;}
  const prog=gl.createProgram();
  gl.attachShader(prog,cs(gl.VERTEX_SHADER,VERTEX_SHADER));
  gl.attachShader(prog,cs(gl.FRAGMENT_SHADER,FRAGMENT_SHADER));
  gl.linkProgram(prog);gl.useProgram(prog);
  [[new Float32Array([-1,-1,1,-1,-1,1,1,1]),"a_position"],[new Float32Array([0,1,1,1,0,0,1,0]),"a_texCoord"]].forEach(([data,name])=>{
    const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);
    const loc=gl.getAttribLocation(prog,name);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
  });
  const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
  [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T].forEach(p=>gl.texParameteri(gl.TEXTURE_2D,p,gl.CLAMP_TO_EDGE));
  [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER].forEach(p=>gl.texParameteri(gl.TEXTURE_2D,p,gl.LINEAR));
  const u1=(n,v)=>gl.uniform1f(gl.getUniformLocation(prog,n),v);
  const u3=(n,a,b,c)=>gl.uniform3f(gl.getUniformLocation(prog,n),a,b,c);
  return{
    loadImage(img){gl.bindTexture(gl.TEXTURE_2D,tex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);},
    render(p,t=0){
      gl.viewport(0,0,canvas.width,canvas.height);
      u1("u_exposure",p.exposure);u1("u_contrast",p.contrast);u1("u_saturation",p.saturation);
      u1("u_temperature",p.temperature);u1("u_tint",p.tint);
      u3("u_lift",...p.lift);u3("u_gamma",...p.gamma);u3("u_gain",...p.gain);
      u1("u_vignette",p.vignette);u1("u_grain",p.grain);u1("u_time",t);
      u3("u_shadowTint",...p.shadowTint);u3("u_highlightTint",...p.highlightTint);
      u1("u_shadowStrength",p.shadowStrength);u1("u_highlightStrength",p.highlightStrength);
      u1("u_flashStrength",p.flashStrength);u1("u_flashThreshold",p.flashThreshold);
      u1("u_backgroundCrush",p.backgroundCrush);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    },
    toDataURL(){return canvas.toDataURL("image/png");},
  };
}

function Slider({label,value,min,max,step=0.01,onChange,accent="#e8c87a"}){
  const pct=((value-min)/(max-min))*100;
  return(
    <div style={{marginBottom:"16px"}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:"7px"}}>
        <span style={{fontSize:"10px",letterSpacing:"0.12em",textTransform:"uppercase",color:"#555",fontFamily:"monospace"}}>{label}</span>
        <span style={{fontSize:"11px",color:"#888",fontFamily:"monospace"}}>{value.toFixed(2)}</span>
      </div>
      <div style={{position:"relative",height:"2px",background:"#181818",borderRadius:"2px"}}>
        <div style={{position:"absolute",left:0,width:`${pct}%`,height:"100%",background:`linear-gradient(90deg,#2a2a2a,${accent})`,borderRadius:"2px"}}/>
        <input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(parseFloat(e.target.value))}
          style={{position:"absolute",inset:"-9px 0",width:"100%",opacity:0,cursor:"pointer",height:"22px"}}/>
        <div style={{position:"absolute",left:`${pct}%`,top:"50%",transform:"translate(-50%,-50%)",width:"10px",height:"10px",borderRadius:"50%",background:"#fff",boxShadow:`0 0 6px ${accent}99`,pointerEvents:"none"}}/>
      </div>
    </div>
  );
}

function PresetCard({preset,selected,onClick}){
  const C={
    prequel:{a:"#e8c87a",bg:"rgba(232,200,122,0.1)",b:"rgba(232,200,122,0.35)",tag:"PREQUEL"},
    royy:{a:"#ff6a2a",bg:"rgba(255,106,42,0.1)",b:"rgba(255,106,42,0.35)",tag:"ROYY"},
    classic:{a:"#5a9fff",bg:"rgba(90,159,255,0.1)",b:"rgba(90,159,255,0.3)",tag:null},
    base:{a:"#444",bg:"transparent",b:"#1a1a1a",tag:null},
  }[preset.category]||{a:"#444",bg:"transparent",b:"#1a1a1a",tag:null};
  return(
    <button onClick={onClick} style={{background:selected?C.bg:"rgba(255,255,255,0.015)",border:`1px solid ${selected?C.b:"#181818"}`,borderRadius:"10px",padding:"11px 13px",cursor:"pointer",textAlign:"left",transition:"all 0.15s",color:"#fff",width:"100%"}}>
      <div style={{display:"flex",alignItems:"center",gap:"9px",marginBottom:"4px"}}>
        <span style={{fontSize:"15px",color:selected?C.a:"#333"}}>{preset.icon}</span>
        <span style={{fontSize:"13px",fontWeight:"600",color:selected?"#ddd":"#666"}}>{preset.name}</span>
        {C.tag&&<span style={{marginLeft:"auto",fontSize:"9px",letterSpacing:"0.1em",padding:"2px 6px",borderRadius:"4px",background:selected?C.bg:"rgba(255,255,255,0.03)",color:selected?C.a:"#3a3a3a",border:`1px solid ${selected?C.b:"#222"}`}}>{C.tag}</span>}
      </div>
      <div style={{fontSize:"10px",color:"#383838",paddingLeft:"24px",lineHeight:"1.5"}}>{preset.description}</div>
    </button>
  );
}

const PARAM_MAP={
  "Exposure":"exposure","Contrast":"contrast","Saturation":"saturation",
  "Temperature":"temperature","Tint":"tint","Flash Strength":"flashStrength",
  "Flash Threshold":"flashThreshold","Crush":"backgroundCrush",
  "Shadow Strength":"shadowStrength","Highlight Strength":"highlightStrength",
  "Vignette":"vignette","Grain":"grain"
};

export default function ColorGradeStudio(){
  const canvasRef=useRef(null),engineRef=useRef(null),imageRef=useRef(null),fileInputRef=useRef(null);
  const[hasImage,setHasImage]=useState(false);
  const[isDragging,setIsDragging]=useState(false);
  const[selectedPreset,setSelectedPreset]=useState("none");
  const[activeTab,setActiveTab]=useState("presets");
  const[filterCategory,setFilterCategory]=useState("all");
  const[params,setParams]=useState(PRESETS[0].params);
  const[imageName,setImageName]=useState("");
  const[isExporting,setIsExporting]=useState(false);

  useEffect(()=>{engineRef.current=createWebGLEngine(canvasRef.current);},[]);
  useEffect(()=>{if(engineRef.current&&imageRef.current)engineRef.current.render(params,performance.now());},[params]);

  const loadImageFile=useCallback((file)=>{
    if(!file||!file.type.startsWith("image/"))return;
    setImageName(file.name);
    const reader=new FileReader();
    reader.onload=(e)=>{
      const img=new Image();
      img.onload=()=>{
        imageRef.current=img;
        const canvas=canvasRef.current;
        let w=img.width,h=img.height;
        if(w>1400){h=h*1400/w;w=1400;}if(h>900){w=w*900/h;h=900;}
        canvas.width=Math.round(w);canvas.height=Math.round(h);
        engineRef.current.loadImage(img);
        engineRef.current.render(params,performance.now());
        setHasImage(true);
      };img.src=e.target.result;
    };reader.readAsDataURL(file);
  },[params]);

  const handleDrop=useCallback((e)=>{e.preventDefault();setIsDragging(false);loadImageFile(e.dataTransfer.files[0]);},[loadImageFile]);
  const applyPreset=useCallback((id)=>{setSelectedPreset(id);const p=PRESETS.find(x=>x.id===id);if(p)setParams({...p.params});},[]);
  const handleExport=useCallback(()=>{
    if(!hasImage)return;setIsExporting(true);
    setTimeout(()=>{const a=document.createElement("a");a.href=engineRef.current.toDataURL();a.download=`graded_${imageName||"image"}.png`;a.click();setIsExporting(false);},100);
  },[hasImage,imageName]);
  const updateParam=useCallback((key,val)=>{setParams(p=>({...p,[key]:val}));setSelectedPreset("custom");},[]);

  const currentPreset=PRESETS.find(p=>p.id===selectedPreset);
  const cat=currentPreset?.category;
  const accentColor=cat==="prequel"?"#e8c87a":cat==="royy"?"#ff6a2a":"#5a9fff";
  const exportBg=hasImage?cat==="prequel"?"linear-gradient(135deg,#7a6028,#e8c87a)":cat==="royy"?"linear-gradient(135deg,#ff4e00,#ff8c42)":"linear-gradient(135deg,#1a6fff,#5a9fff)":"#111";
  const filteredPresets=PRESETS.filter(p=>filterCategory==="all"||p.category===filterCategory||p.id==="none");
  const isFlash=selectedPreset==="prequel_flash";

  const SECTIONS=[
    ["Tone",[["Exposure",-2,2],["Contrast",0.5,2],["Saturation",0,2]]],
    ["White Balance",[["Temperature",-1,1],["Tint",-1,1]]],
    ...(isFlash?[["⚡ Flash",[["Flash Strength",0,1],["Flash Threshold",0,1],["Crush",0,1]]]]:[]),
    ["Zone Color",[["Shadow Strength",0,1],["Highlight Strength",0,1]]],
    ["Style",[["Vignette",0,1],["Grain",0,1]]],
  ];

  return(
    <div style={{display:"flex",height:"100vh",background:"#070707",color:"#fff",fontFamily:"'Syne','Helvetica Neue',sans-serif",overflow:"hidden"}}>

      <div style={{width:"60px",background:"#090909",borderRight:"1px solid #131313",display:"flex",flexDirection:"column",alignItems:"center",padding:"16px 0",gap:"4px",flexShrink:0}}>
        <div style={{fontSize:"18px",marginBottom:"14px",color:accentColor,transition:"color 0.3s"}}>◈</div>
        {[{id:"presets",icon:"▦"},{id:"adjust",icon:"⊞"}].map(tab=>(
          <button key={tab.id} onClick={()=>setActiveTab(tab.id)} style={{width:"38px",height:"38px",borderRadius:"9px",border:"none",cursor:"pointer",background:activeTab===tab.id?"rgba(255,255,255,0.05)":"transparent",color:activeTab===tab.id?"#bbb":"#333",fontSize:"16px",display:"flex",alignItems:"center",justifyContent:"center"}}>{tab.icon}</button>
        ))}
      </div>

      <div style={{width:"264px",background:"#090909",borderRight:"1px solid #131313",display:"flex",flexDirection:"column",flexShrink:0,overflow:"hidden"}}>
        <div style={{padding:"16px 16px 12px",borderBottom:"1px solid #131313"}}>
          <div style={{fontSize:"9px",letterSpacing:"0.18em",textTransform:"uppercase",color:"#333",marginBottom:"3px",fontFamily:"monospace"}}>{activeTab==="presets"?"Filters & Grades":"Parameter Control"}</div>
          <div style={{fontSize:"16px",fontWeight:"700",color:"#bbb",letterSpacing:"-0.02em"}}>{activeTab==="presets"?"Presets":"Adjustments"}</div>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"12px"}}>
          {activeTab==="presets"?(
            <>
              <div style={{display:"flex",gap:"4px",marginBottom:"12px",flexWrap:"wrap"}}>
                {CATEGORIES.map(c=>(
                  <button key={c.id} onClick={()=>setFilterCategory(c.id)} style={{padding:"4px 9px",borderRadius:"6px",border:"none",cursor:"pointer",background:filterCategory===c.id?"rgba(255,255,255,0.07)":"transparent",color:filterCategory===c.id?"#aaa":"#3a3a3a",fontSize:"10px",fontWeight:"600",letterSpacing:"0.06em"}}>{c.label}</button>
                ))}
              </div>
              {(filterCategory==="all"||filterCategory==="prequel")&&(
                <div style={{background:"linear-gradient(135deg,rgba(232,200,122,0.06),transparent)",border:"1px solid rgba(232,200,122,0.1)",borderRadius:"9px",padding:"9px 11px",marginBottom:"8px"}}>
                  <div style={{fontSize:"10px",fontWeight:"700",color:"#e8c87a",letterSpacing:"0.08em",marginBottom:"2px"}}>PREQUEL APP</div>
                  <div style={{fontSize:"10px",color:"#3a3a3a",lineHeight:"1.5"}}>Flash · Background crush · Analog feel</div>
                </div>
              )}
              {(filterCategory==="all"||filterCategory==="royy")&&(
                <div style={{background:"linear-gradient(135deg,rgba(255,78,0,0.06),transparent)",border:"1px solid rgba(255,78,0,0.1)",borderRadius:"9px",padding:"9px 11px",marginBottom:"8px"}}>
                  <div style={{fontSize:"10px",fontWeight:"700",color:"#ff6a2a",letterSpacing:"0.08em",marginBottom:"2px"}}>@royyschneider</div>
                  <div style={{fontSize:"10px",color:"#3a3a3a",lineHeight:"1.5"}}>Toronto night · Teal shadows · Hot orange</div>
                </div>
              )}
              <div style={{display:"flex",flexDirection:"column",gap:"5px"}}>
                {filteredPresets.map(p=><PresetCard key={p.id} preset={p} selected={selectedPreset===p.id} onClick={()=>applyPreset(p.id)}/>)}
              </div>
            </>
          ):(
            <div>
              {SECTIONS.map(([section,sliders])=>(
                <div key={section} style={{marginBottom:"20px"}}>
                  <div style={{fontSize:"9px",letterSpacing:"0.14em",textTransform:"uppercase",color:section.includes("Flash")?"#e8c87a55":"#2a2a2a",marginBottom:"12px",fontFamily:"monospace"}}>{section}</div>
                  {sliders.map(([label,min,max])=>(
                    <Slider key={label} label={label} value={params[PARAM_MAP[label]]??0} min={min} max={max} accent={accentColor}
                      onChange={v=>updateParam(PARAM_MAP[label],v)}/>
                  ))}
                </div>
              ))}
              <button onClick={()=>applyPreset("none")} style={{width:"100%",padding:"9px",background:"transparent",border:"1px solid #1a1a1a",borderRadius:"8px",color:"#3a3a3a",fontSize:"11px",cursor:"pointer",letterSpacing:"0.06em"}}>Reset to Original</button>
            </div>
          )}
        </div>
        <div style={{padding:"12px",borderTop:"1px solid #131313"}}>
          <button onClick={handleExport} disabled={!hasImage||isExporting} style={{width:"100%",padding:"11px",borderRadius:"9px",border:"none",cursor:hasImage?"pointer":"not-allowed",background:exportBg,color:hasImage?"#000":"#2a2a2a",fontWeight:"800",fontSize:"12px",letterSpacing:"0.1em",opacity:isExporting?0.5:1}}>
            {isExporting?"EXPORTING…":"EXPORT PNG"}
          </button>
        </div>
      </div>

      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{height:"44px",borderBottom:"1px solid #131313",display:"flex",alignItems:"center",padding:"0 18px",gap:"12px",flexShrink:0}}>
          <span style={{fontSize:"11px",color:"#2a2a2a"}}>
            {hasImage?<><span style={{color:"#3a3a3a"}}>{imageName}</span> · <span style={{color:accentColor}}>{currentPreset?.name||"Custom"}</span></>:"Drop an image to begin"}
          </span>
          <div style={{flex:1}}/>
          <button onClick={()=>fileInputRef.current?.click()} style={{padding:"5px 12px",background:"rgba(255,255,255,0.03)",border:"1px solid #1c1c1c",borderRadius:"6px",color:"#555",fontSize:"11px",cursor:"pointer",letterSpacing:"0.05em"}}>Open Image</button>
          <input ref={fileInputRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>loadImageFile(e.target.files[0])}/>
        </div>
        <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",position:"relative",overflow:"hidden",background:"#070707",border:isDragging?`2px dashed ${accentColor}44`:"2px solid transparent"}}
          onDragOver={e=>{e.preventDefault();setIsDragging(true);}} onDragLeave={()=>setIsDragging(false)} onDrop={handleDrop}>
          <div style={{position:"absolute",inset:0,backgroundImage:"linear-gradient(rgba(255,255,255,0.01) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.01) 1px,transparent 1px)",backgroundSize:"48px 48px",pointerEvents:"none"}}/>
          <canvas ref={canvasRef} style={{display:hasImage?"block":"none",maxWidth:"100%",maxHeight:"100%",boxShadow:"0 20px 120px rgba(0,0,0,0.98)"}}/>
          {!hasImage&&(
            <div style={{textAlign:"center",position:"relative",zIndex:1}}>
              <div style={{width:"66px",height:"66px",borderRadius:"16px",margin:"0 auto 18px",background:"rgba(255,255,255,0.02)",border:"1px solid #181818",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"26px",color:"#282828"}}>⚡</div>
              <div style={{fontSize:"18px",fontWeight:"700",color:"#282828",marginBottom:"8px",letterSpacing:"-0.02em"}}>Drop your image here</div>
              <div style={{fontSize:"12px",color:"#1e1e1e",marginBottom:"22px"}}>JPG · PNG · WebP</div>
              <button onClick={()=>fileInputRef.current?.click()} style={{padding:"10px 24px",background:"transparent",border:"1px solid #1e1e1e",borderRadius:"9px",color:"#3a3a3a",fontSize:"12px",cursor:"pointer",letterSpacing:"0.05em"}}>Choose Image</button>
            </div>
          )}
        </div>
        <div style={{height:"28px",borderTop:"1px solid #131313",display:"flex",alignItems:"center",padding:"0 18px",gap:"18px"}}>
          {[["Engine","WebGL"],["Shader","GLSL ES"],["FX","LGG · Zone Tint · Flash Crush"],["Presets","Prequel · royyschneider · Classic"]].map(([k,v])=>(
            <span key={k} style={{fontSize:"9px",color:"#1e1e1e",fontFamily:"monospace"}}><span style={{color:"#2a2a2a"}}>{k}</span> · {v}</span>
          ))}
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#1c1c1c;border-radius:2px}
        button{font-family:inherit}
      `}</style>
    </div>
  );
}
