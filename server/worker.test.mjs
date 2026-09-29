import assert from 'node:assert/strict';
import worker, { AppointmentStore } from './worker.mjs';

const origin = 'https://jxhn-star.github.io';
const records = new Map();
const storage = {
  async put(key,value){ records.set(key,structuredClone(value)); },
  async get(key){ return records.get(key); },
  async list({prefix}){ return new Map([...records].filter(([key]) => key.startsWith(prefix))); }
};
const store = new AppointmentStore({storage});
const namespace = { idFromName: value => value, get: () => ({ fetch: request => store.fetch(typeof request === 'string' ? new Request(request) : request) }) };
const limiter = { limit: async () => ({success:true}) };
const env = { ALLOWED_ORIGIN:origin, EMPLOYEE_PASSWORD:'correct horse battery staple', APPOINTMENT_STORE:namespace, APPOINTMENT_LIMITER:limiter, LOGIN_LIMITER:limiter };
const call = (path,{method='GET',body,token,requestOrigin=origin}={}) => worker.fetch(new Request(`https://worker.test${path}`,{
  method, headers:{Origin:requestOrigin,...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},
  body:body ? JSON.stringify(body) : undefined
}),env);

assert.equal((await call('/api/employee/appointments')).status,401);
assert.equal((await call('/api/employee/login',{method:'POST',body:{password:'wrong'}})).status,401);
const login = await call('/api/employee/login',{method:'POST',body:{password:env.EMPLOYEE_PASSWORD}});
assert.equal(login.status,200);
const loginBody = await login.json();
assert.ok(loginBody.token);
assert.ok(!JSON.stringify(loginBody).includes(env.EMPLOYEE_PASSWORD));

const appointment = {
  name:'Erika Mustermann',email:'erika@example.de',phone:'0151 12345678',topic:'Wohnen',topicLabel:'Wohnen',
  mode:'Vor Ort',date:'2026-10-10',time:'10:30',location:'Caritashaus Limburg',
  preferredLanguage:'Deutsch',accessibilityNeeds:'Stufenloser Zugang',consent:true,website:''
};
const created = await call('/api/appointments',{method:'POST',body:appointment});
assert.equal(created.status,201);
const createdBody = await created.json();
assert.ok(createdBody.bookingId.startsWith('CW-'));

const listed = await call('/api/employee/appointments',{token:loginBody.token});
assert.equal(listed.status,200);
const listedBody = await listed.json();
assert.equal(listedBody.appointments.length,2);
const storedAppointment = listedBody.appointments.find(item => item.bookingId === createdBody.bookingId);
const testAppointment = listedBody.appointments.find(item => item.bookingId === 'CW-20260929-E62DC87E');
assert.equal(storedAppointment.email,appointment.email);
assert.equal(storedAppointment.phone,appointment.phone);
assert.equal(testAppointment.isTest,true);

const updated = await call(`/api/employee/appointments/${createdBody.bookingId}`,{method:'PATCH',body:{status:'bestaetigt'},token:loginBody.token});
assert.equal(updated.status,200);
assert.equal((await updated.json()).appointment.status,'bestaetigt');
assert.equal((await call('/api/appointments',{method:'POST',body:{...appointment,phone:'1'}})).status,400);
assert.equal((await call('/api/employee/login',{method:'POST',body:{password:env.EMPLOYEE_PASSWORD},requestOrigin:'https://evil.example'})).status,403);
console.log('PASS: employee login, protected list, appointment storage, contact fields, status update, validation and origin checks.');
