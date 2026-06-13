import { useEffect, useState } from "react";
import { Activity, Calculator, Plus, Settings, Shield, Trash2, Users } from "lucide-react";
import { api } from "../api/client";

export function AdminPage() {
  const [tab,setTab]=useState("matches");
  const tabs=[["matches","Partidos",Shield],["users","Usuarios",Users],["points","Ajustes",Plus],["recalculate","Recálculo",Calculator],["settings","Configuración",Settings],["logs","Actividad",Activity]];
  return <div className="page"><section className="page-heading compact"><span className="eyebrow">CENTRO DE CONTROL</span><h1>Gestión de la porra</h1></section><div className="admin-tabs">{tabs.map(([id,label,Icon])=><button className={tab===id?"active":""} onClick={()=>setTab(id)} key={id}><Icon size={16}/>{label}</button>)}</div>
    {tab==="matches"&&<AdminMatches/>}{tab==="users"&&<AdminUsers/>}{tab==="points"&&<AdminPoints/>}{tab==="recalculate"&&<AdminRecalculate/>}{tab==="settings"&&<AdminSettings/>}{tab==="logs"&&<AdminLogs/>}
  </div>;
}
const Notice=({text})=>text?<div className="alert success">{text}</div>:null;

function AdminMatches(){
  const blank={match_date:"",match_time:"",stadium:"",team1:"",team2:"",auto_close_at:""};
  const [matches,setMatches]=useState([]),[form,setForm]=useState(blank),[edit,setEdit]=useState(null),[notice,setNotice]=useState("");
  const load=()=>api("/matches").then(setMatches); useEffect(()=>{load()},[]);
  const save=async e=>{e.preventDefault();await api(edit?`/matches/${edit}`:"/matches",{method:edit?"PUT":"POST",body:form});setForm(blank);setEdit(null);setNotice("Partido guardado.");load()};
  const startEdit=m=>{setEdit(m.id);setForm({match_date:m.match_date,match_time:m.match_time,stadium:m.stadium,team1:m.team1,team2:m.team2,auto_close_at:m.auto_close_at.slice(0,16)})};
  const status=async(id,value)=>{await api(`/matches/${id}/status`,{method:"PATCH",body:{status:value}});load()};
  const finish=async m=>{const score=window.prompt(`Resultado ${m.team1}-${m.team2} (ej. 2-1)`);if(!score)return;const [a,b]=score.split("-").map(Number);await api(`/matches/${m.id}/finish`,{method:"POST",body:{result_team1:a,result_team2:b}});setNotice("Resultado guardado y puntos recalculados.");load()};
  const remove=async m=>{if(window.confirm(`¿Eliminar ${m.team1} - ${m.team2}?`)){await api(`/matches/${m.id}`,{method:"DELETE"});load()}};
  return <section className="admin-section"><Notice text={notice}/><form className="admin-form" onSubmit={save}><h3>{edit?"Editar partido":"Nuevo partido"}</h3><div className="form-grid"><label>Fecha<input type="date" required value={form.match_date} onChange={e=>setForm({...form,match_date:e.target.value})}/></label><label>Hora<input type="time" required value={form.match_time} onChange={e=>setForm({...form,match_time:e.target.value})}/></label><label>Equipo 1<input required value={form.team1} onChange={e=>setForm({...form,team1:e.target.value})}/></label><label>Equipo 2<input required value={form.team2} onChange={e=>setForm({...form,team2:e.target.value})}/></label><label>Estadio<input value={form.stadium} onChange={e=>setForm({...form,stadium:e.target.value})}/></label><label>Cierre personalizado<input type="datetime-local" value={form.auto_close_at} onChange={e=>setForm({...form,auto_close_at:e.target.value})}/></label></div><button className="primary">{edit?"Guardar cambios":"Crear partido"}</button>{edit&&<button type="button" className="secondary" onClick={()=>{setEdit(null);setForm(blank)}}>Cancelar</button>}</form>
    <div className="admin-list">{matches.map(m=><div key={m.id}><div><strong>{m.team1} – {m.team2}</strong><span>{m.match_date} · {m.match_time} · {m.status}</span></div><div className="actions"><button onClick={()=>startEdit(m)}>Editar</button>{m.status==="open"&&<button onClick={()=>status(m.id,"closed")}>Cerrar</button>}{m.status==="closed"&&<button onClick={()=>status(m.id,"open")}>Reabrir</button>}<button className="accent" onClick={()=>finish(m)}>Resultado</button><button className="danger" onClick={()=>remove(m)}>Eliminar</button></div></div>)}</div></section>;
}
function AdminUsers(){
  const [users,setUsers]=useState([]),[form,setForm]=useState({username:"",password:"",role:"user"}),[notice,setNotice]=useState("");
  const load=()=>api("/users").then(setUsers);useEffect(()=>{load()},[]);
  const add=async e=>{e.preventDefault();await api("/users",{method:"POST",body:form});setForm({username:"",password:"",role:"user"});setNotice("Usuario creado.");load()};
  const edit=async u=>{const password=window.prompt(`Nueva contraseña para ${u.username} (vacío para mantener)`,"");if(password===null)return;await api(`/users/${u.id}`,{method:"PUT",body:{username:u.username,role:u.role,password}});setNotice("Usuario actualizado.");load()};
  const remove=async u=>{
    if(!window.confirm(`¿Eliminar definitivamente a ${u.username}? También se borrarán sus apuestas, puntos y notificaciones.`))return;
    await api(`/users/${u.id}`,{method:"DELETE"});
    setNotice(`Usuario ${u.username} eliminado.`);
    load();
  };
  return <section className="admin-section"><Notice text={notice}/><form className="admin-form inline-form" onSubmit={add}><h3>Crear usuario</h3><input placeholder="Usuario" required value={form.username} onChange={e=>setForm({...form,username:e.target.value})}/><input placeholder="Contraseña" required value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/><select value={form.role} onChange={e=>setForm({...form,role:e.target.value})}><option value="user">Usuario</option><option value="admin">Admin</option></select><button className="primary">Crear</button></form><div className="admin-list">{users.map(u=><div key={u.id}><div><strong>{u.username}</strong><span>{u.role} · {u.active?"Activo":"Desactivado"}</span></div><div className="actions"><button onClick={()=>edit(u)}>Contraseña</button><button onClick={async()=>{await api(`/users/${u.id}`,{method:"PUT",body:{username:u.username,role:u.role==="admin"?"user":"admin"}});load()}}>Rol: {u.role}</button><button className={u.active?"danger":"accent"} onClick={async()=>{await api(`/users/${u.id}/active`,{method:"PATCH",body:{active:!u.active}});load()}}>{u.active?"Desactivar":"Activar"}</button><button className="danger delete-user" disabled={u.username.toLowerCase()==="administrador"} title={u.username.toLowerCase()==="administrador"?"La cuenta inicial no se puede eliminar":"Eliminar usuario"} onClick={()=>remove(u)}><Trash2 size={14}/>Eliminar</button></div></div>)}</div></section>;
}
function AdminPoints(){
  const [users,setUsers]=useState([]),[rows,setRows]=useState([]),[form,setForm]=useState({user_id:"",points:"",reason:""});
  const load=()=>Promise.all([api("/users"),api("/admin/points-adjustments")]).then(([u,r])=>{setUsers(u);setRows(r)});useEffect(()=>{load()},[]);
  const save=async e=>{e.preventDefault();await api("/admin/points-adjustments",{method:"POST",body:{...form,points:Number(form.points)}});setForm({user_id:"",points:"",reason:""});load()};
  return <section className="admin-section"><form className="admin-form inline-form" onSubmit={save}><h3>Ajuste manual</h3><select required value={form.user_id} onChange={e=>setForm({...form,user_id:e.target.value})}><option value="">Usuario</option>{users.map(u=><option key={u.id} value={u.id}>{u.username}</option>)}</select><input type="number" required placeholder="+/- puntos" value={form.points} onChange={e=>setForm({...form,points:e.target.value})}/><input required placeholder="Motivo" value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})}/><button className="primary">Aplicar</button></form><div className="admin-list">{rows.map(r=><div key={r.id}><div><strong>{r.username}</strong><span>{r.reason} · por {r.created_by_username}</span></div><b className={r.points<0?"negative":"points"}>{r.points>0?"+":""}{r.points}</b></div>)}</div></section>;
}
function AdminRecalculate(){
 const [matches,setMatches]=useState([]),[notice,setNotice]=useState("");useEffect(()=>{api("/matches").then(setMatches)},[]);
 const run=async id=>{const r=await api(id?`/admin/recalculate/${id}`:"/admin/recalculate",{method:"POST"});setNotice(`${r.recalculated} predicciones recalculadas.`)};
 return <section className="admin-section"><Notice text={notice}/><div className="action-panel"><Calculator size={32}/><h3>Recalcular puntuaciones</h3><p>Vuelve a aplicar las reglas actuales sobre partidos con resultado.</p><button className="primary" onClick={()=>run()}>Recalcular todo</button></div><div className="admin-list">{matches.filter(m=>m.status==="finished").map(m=><div key={m.id}><strong>{m.team1} {m.result_team1} – {m.result_team2} {m.team2}</strong><button onClick={()=>run(m.id)}>Recalcular partido</button></div>)}</div></section>;
}
function AdminSettings(){
 const [form,setForm]=useState(null),[notice,setNotice]=useState("");useEffect(()=>{api("/admin/settings").then(setForm)},[]);if(!form)return null;
 const save=async e=>{e.preventDefault();setForm(await api("/admin/settings",{method:"PUT",body:form}));setNotice("Configuración guardada.")};
 return <section className="admin-section"><Notice text={notice}/><form className="admin-form" onSubmit={save}><h3>Reglas generales</h3><div className="form-grid"><label>Nombre de la porra<input value={form.pool_name} onChange={e=>setForm({...form,pool_name:e.target.value})}/></label><label>Puntos por ganador<input type="number" min="0" value={form.winner_points} onChange={e=>setForm({...form,winner_points:e.target.value})}/></label><label>Puntos por exacto<input type="number" min="0" value={form.exact_result_points} onChange={e=>setForm({...form,exact_result_points:e.target.value})}/></label><label>Minutos antes del partido<input type="number" min="0" value={form.auto_close_minutes_before} onChange={e=>setForm({...form,auto_close_minutes_before:e.target.value})}/></label><label className="toggle"><input type="checkbox" checked={form.auto_close_enabled==="1"} onChange={e=>setForm({...form,auto_close_enabled:e.target.checked?"1":"0"})}/>Activar cierre automático</label></div><button className="primary">Guardar configuración</button></form></section>;
}
function AdminLogs(){
 const [rows,setRows]=useState([]),[filters,setFilters]=useState({action_type:"",entity_type:"",date:""});
 const load=()=>api(`/admin/actions-log?${new URLSearchParams(filters)}`).then(setRows);useEffect(()=>{load()},[]);
 return <section className="admin-section"><div className="filter-bar"><input placeholder="Tipo de acción" value={filters.action_type} onChange={e=>setFilters({...filters,action_type:e.target.value})}/><select value={filters.entity_type} onChange={e=>setFilters({...filters,entity_type:e.target.value})}><option value="">Todas las entidades</option><option value="match">Partido</option><option value="user">Usuario</option><option value="prediction">Predicción</option><option value="settings">Configuración</option></select><input type="date" value={filters.date} onChange={e=>setFilters({...filters,date:e.target.value})}/><button className="primary" onClick={load}>Filtrar</button></div><div className="log-list">{rows.map(r=><details key={r.id}><summary><span>{new Date(r.created_at).toLocaleString("es-ES")}</span><strong>{r.action_type}</strong><span>{r.admin_username||"Sistema"} · {r.entity_type}{r.entity_id?` #${r.entity_id}`:""}</span><p>{r.description}</p></summary><div><pre>{r.before_data||"Sin datos anteriores"}</pre><pre>{r.after_data||"Sin datos posteriores"}</pre></div></details>)}</div></section>;
}
