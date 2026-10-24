import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';
import { 
  LayoutDashboard, FileText, Map, LogOut, ChevronRight, CheckCircle, Circle, 
  Briefcase, Zap, BrainCircuit, Activity, ExternalLink, Loader2, Search, 
  MessageSquare, X, Send, Newspaper, GraduationCap, Users, Code, PenTool, BarChart3, LineChart, ChevronDown
} from 'lucide-react';

// --- Firebase Configuration & Initialization ---
const env = (import.meta as any).env || {};
const firebaseConfig = typeof __firebase_config !== 'undefined'
  ? (typeof __firebase_config === 'string' ? JSON.parse(__firebase_config) : __firebase_config)
  : { apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN, projectId: env.VITE_FIREBASE_PROJECT_ID, storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET, messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID, appId: env.VITE_FIREBASE_APP_ID };
const localAuthMode = !firebaseConfig.apiKey || firebaseConfig.apiKey.includes('demo-local-placeholder') || !firebaseConfig.authDomain || firebaseConfig.authDomain === 'localhost' || !firebaseConfig.projectId || firebaseConfig.projectId === 'skillbridge-local-demo';
const app = localAuthMode ? null : initializeApp(firebaseConfig);
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'skillbridge-default-id';
const emptyUserProfile = () => ({ name: '', location: '', headline: '', overview: '', skills: [], experienceSummary: '', education: '', preferredWorkType: 'Any', resumeText: '', targetJob: '', isFresher: null, additionalInfo: '', foundJobs: [], exampleRequirements: [], analyses: {}, news: [] });
const isKnownSeedProfile = (profile) => profile?.name === 'Maya Sharma' && profile?.headline === 'Junior Frontend Developer | React and accessible UI' && typeof profile?.resumeText === 'string' && profile.resumeText.startsWith('SUMMARY\nEarly-career frontend developer with internship experience');
const localProfileKey = (uid) => 'skillbridge_profile_' + uid;
const saveUserProfile = async (uid, patch) => {
  if (localAuthMode) {
    const previous = JSON.parse(localStorage.getItem(localProfileKey(uid)) || '{}');
    const next = { ...emptyUserProfile(), ...previous, ...patch };
    localStorage.setItem(localProfileKey(uid), JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('skillbridge-profile-updated', { detail: { uid, profile: next } }));
    return;
  }
  await setDoc(doc(db, 'artifacts', appId, 'users', uid, 'profile', 'main'), patch, { merge: true });
};
const formatAIError = (data, status) => {
  const error = data && data.error || {};
  const code = error.code || error.status || '';
  const message = error.message || '';
  if (status === 429 || status === 402 || /quota|rate_limit|resource_exhausted/i.test(code)) {
    return message ? 'AI provider limit reached: ' + message : 'AI provider limit reached. Wait and retry or check provider limits.';
  }
  return message || 'AI request failed (' + status + ').';
};

const callAI = async (payload) => {
  const response = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(formatAIError(data, response.status));
  const choices = data && data.choices || [];
  const text = choices[0] && choices[0].message && choices[0].message.content && choices[0].message.content.trim();
  if (!text) throw new Error('The AI service returned an empty response.');
  return text;
};

const streamAI = async (payload, onText) => {
  const response = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload, stream: true }) });
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(formatAIError(data, response.status)); }
  if (!response.body) throw new Error('Streaming is unavailable in this browser.');
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let result = '';
  const consume = (line) => {
    line = line.replace(/\r$/, '');
    if (!line.startsWith('data:')) return;
    const raw = line.slice(5).trim(); if (!raw || raw === '[DONE]') return;
    try {
      const chunk = JSON.parse(raw);
      const choices = chunk && chunk.choices || [];
      const delta = choices[0] && choices[0].delta || {};
      const text = delta.content || '';
      if (text) { result += text; onText(result); }
    } catch { /* Ignore incomplete stream events. */ }
  };
  while (true) { const part = await reader.read(); buffer += decoder.decode(part.value || new Uint8Array(), { stream: !part.done }); const lines = buffer.split('\n'); buffer = lines.pop() || ''; lines.forEach(consume); if (part.done) break; }
  consume(buffer); if (!result.trim()) throw new Error('The AI service returned an empty response.'); return result.trim();
};

const parseAIJson = (text) => {
  const fence = String.fromCharCode(96).repeat(3);
  let clean = String(text || '').trim();
  if (clean.startsWith(fence + 'json')) clean = clean.slice(7);
  else if (clean.startsWith(fence)) clean = clean.slice(3);
  if (clean.endsWith(fence)) clean = clean.slice(0, -3);
  clean = clean.trim();
  try { const parsed = JSON.parse(clean); return parsed && !Array.isArray(parsed) && Object.prototype.hasOwnProperty.call(parsed, 'result') ? parsed.result : parsed; } catch { /* Try a JSON block embedded in surrounding text. */ }
  const match = clean.match(/[\[{][\s\S]*[\]}]/);
  if (match) { try { const parsed = JSON.parse(match[0]); return parsed && !Array.isArray(parsed) && Object.prototype.hasOwnProperty.call(parsed, 'result') ? parsed.result : parsed; } catch { /* Continue to the clear error below. */ } }
  throw new Error('The AI service returned an unreadable structured response.');
};

// --- AI Helpers ---

const searchRealJobsWithAI = async (targetJob, isFresher, candidate = {}) => {
  const levelText = isFresher ? "entry-level, junior, or new graduate" : "experienced";
  const candidateContext = [
    candidate.headline && `Headline: ${candidate.headline}`,
    candidate.location && `Preferred location: ${candidate.location}`,
    candidate.preferredWorkType && candidate.preferredWorkType !== 'Any' && `Preferred work type: ${candidate.preferredWorkType}`,
    candidate.skills?.length && `Skills: ${candidate.skills.join(', ')}`,
    candidate.education && `Education: ${candidate.education}`,
    candidate.experienceSummary && `Relevant experience/projects: ${candidate.experienceSummary}`,
    candidate.overview && `Career overview: ${candidate.overview}`,
    candidate.additionalInfo && `Additional profile details: ${candidate.additionalInfo}`,
    candidate.resumeText && `Resume: ${candidate.resumeText.slice(0, 2500)}`
  ].filter(Boolean).join('\n');
  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: `Search the web for 4 distinct, real, currently active ${levelText} job postings for the role of "${targetJob}". Use verified public job listing pages and include a direct listing URL.\n\nCandidate profile for personalization:\n${candidateContext || 'No additional candidate details provided.'}\n\nFor each listing, compare only its published requirements and location/work arrangement with the candidate profile. Return the actual listing details plus a cautious 0-100 match_percentage, matched_skills, missing_skills, and a one-sentence match_summary. Do not invent job requirements; mark uncertain comparisons conservatively.` }]
      }
    ],
    tools: [{ "google_search": {} }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            id: { type: "STRING" },
            title: { type: "STRING" },
            company: { type: "STRING" },
            location: { type: "STRING" },
            url: { type: "STRING" },
            requirements_summary: { type: "STRING" },
            match_percentage: { type: "INTEGER" },
            matched_skills: { type: "ARRAY", items: { type: "STRING" } },
            missing_skills: { type: "ARRAY", items: { type: "STRING" } },
            match_summary: { type: "STRING" }
          },
          required: ["id", "title", "company", "location", "url", "requirements_summary", "match_percentage", "matched_skills", "missing_skills", "match_summary"]
        }
      }
    }
  };

  return parseAIJson(await callAI(payload));
};

const analyzeSpecificJobFit = async (resumeText, jobData, isFresher) => {
  const fresherPrompt = isFresher ? "Focus heavily on foundational skills, portfolio building, and entry-level requirements since this is a fresher." : "Focus on bridging the gap between their current experience and the specific requirements.";
  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: `Act as a senior career coach. Compare this candidate's resume against this real job posting.
        Job: ${jobData.title} at ${jobData.company}
        Requirements: ${jobData.requirements_summary}
        Resume: ${resumeText}
        
        ${fresherPrompt}
        Calculate a skill match percentage (0-100). Identify matched skills, missing skills, and create a prioritized learning roadmap broken into specific tasks.` }]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          matched_skills: { type: "ARRAY", items: { type: "STRING" } },
          missing_skills: { type: "ARRAY", items: { type: "STRING" } },
          skill_match_percentage: { type: "INTEGER" },
          roadmap_tasks: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                id: { type: "STRING" },
                skill: { type: "STRING" },
                description: { type: "STRING" },
                estimated_duration: { type: "STRING" }
              }
            }
          }
        },
        required: ["matched_skills", "missing_skills", "skill_match_percentage", "roadmap_tasks"]
      }
    }
  };

  return parseAIJson(await callAI(payload));
};

const fetchIndustryNews = async (targetJob) => {
  const payload = {
    contents: [{ role: "user", parts: [{ text: `Search Google for the 3 latest important news articles or industry trends related to "${targetJob}" careers or technology. Return as JSON.` }] }],
    tools: [{ "google_search": {} }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: { title: { type: "STRING" }, summary: { type: "STRING" }, url: { type: "STRING" } },
          required: ["title", "summary", "url"]
        }
      }
    }
  };
  return parseAIJson(await callAI(payload));
};

const chatWithAI = async (message, history, context, onText) => {
  const recentHistory = history.slice(1, -1).slice(-8);
  const formattedHistory = recentHistory.map(h => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.content.slice(0, 1600) }] }));
  const firstName = context.name?.trim().split(/\s+/)[0];
  const systemContext = [
    'You are SkillBridge, a warm, practical career coach. Give concise, actionable replies, usually in 2 to 5 sentences. Ask one focused follow-up question only when it helps.',
    firstName ? 'The candidate prefers to be called ' + firstName + '. Use their name naturally, not in every reply.' : '',
    context.targetJob ? 'Target role: ' + context.targetJob + '.' : '',
    context.isFresher ? 'Career stage: early career; make suggestions suitable for a first job, internship, or graduate role.' : 'Career stage: experienced professional; build on existing work history and transferable skills.',
    context.skills?.length ? 'Skills: ' + context.skills.slice(0, 12).join(', ') + '.' : '',
    context.location ? 'Preferred location: ' + context.location + '.' : ''
  ].filter(Boolean).join(' ');
  const payload = { systemInstruction: { parts: [{ text: systemContext }] }, contents: [...formattedHistory, { role: 'user', parts: [{ text: message }] }], generationConfig: { maxOutputTokens: 500, temperature: 0.6 } };
  return streamAI(payload, onText);
};

// --- Main Application Component ---
export default function App() {
  const [user, setUser] = useState(null);
  const [authInitialized, setAuthInitialized] = useState(false);
  const [currentView, setCurrentView] = useState('landing');
  const [userData, setUserData] = useState(emptyUserProfile);
  const [loadingData, setLoadingData] = useState(true);
  const [authModal, setAuthModal] = useState(null); // 'login' | 'register' | null
  const [authDestination, setAuthDestination] = useState('dashboard');

  useEffect(() => {
    if (localAuthMode) {
      const savedSession = localStorage.getItem('skillbridge_preview_session');
      if (savedSession) {
        try { setUser(JSON.parse(savedSession)); } catch { localStorage.removeItem('skillbridge_preview_session'); }
      }
      setAuthInitialized(true);
      return;
    }
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) await signInWithCustomToken(auth, __initial_auth_token);
        else await signInAnonymously(auth);
      } catch (err) { console.error("Auth error:", err); }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthInitialized(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (localAuthMode) {
      if (!user) { setUserData(emptyUserProfile()); setLoadingData(false); return; }
      const loadLocalProfile = () => {
        try { const savedProfile = JSON.parse(localStorage.getItem(localProfileKey(user.uid)) || '{}'); if (isKnownSeedProfile(savedProfile)) { const blankProfile = emptyUserProfile(); localStorage.setItem(localProfileKey(user.uid), JSON.stringify(blankProfile)); setUserData(blankProfile); } else setUserData({ ...emptyUserProfile(), ...savedProfile }); }
        catch { setUserData(emptyUserProfile()); }
        setLoadingData(false);
      };
      loadLocalProfile();
      const onUpdated = (event) => { if (event.detail?.uid === user.uid) setUserData(event.detail.profile); };
      window.addEventListener('skillbridge-profile-updated', onUpdated);
      return () => window.removeEventListener('skillbridge-profile-updated', onUpdated);
    }
    if (!user) { setLoadingData(false); return; }
    const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'main');
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists() && isKnownSeedProfile(docSnap.data())) { const blankProfile = emptyUserProfile(); setUserData(blankProfile); setDoc(docRef, blankProfile).catch(err => console.error('Could not clear the old sample profile:', err)); }
      else if (docSnap.exists()) setUserData({ ...emptyUserProfile(), ...docSnap.data() });
      else setUserData(emptyUserProfile());
      setLoadingData(false);
    });
    return () => unsubscribe();
  }, [user]);

  const navigate = (view) => setCurrentView(view);

  if (!authInitialized) {
    return <div className="min-h-screen bg-[#0B1020] flex items-center justify-center"><Loader2 className="w-8 h-8 text-[#3B82F6] animate-spin" /></div>;
  }

  return (
    <div className="min-h-screen bg-[#0B1020] text-white font-sans overflow-hidden flex flex-col">
      {authModal && <AuthModal type={authModal} localMode={localAuthMode} destination={authDestination} onAuthenticated={(nextUser) => { setUser(nextUser); localStorage.setItem('skillbridge_preview_session', JSON.stringify(nextUser)); }} onClose={() => setAuthModal(null)} onSwitch={() => { const nextType = authModal === 'register' ? 'login' : 'register'; setAuthDestination(nextType === 'register' ? 'profile' : 'dashboard'); setAuthModal(nextType); }} onNavigate={navigate} />}
      {currentView === 'landing' ? (
        <LandingPage 
          onGetStarted={(track) => { localStorage.setItem('skillbridge_selected_track', track); user ? navigate('profile') : (setAuthDestination('profile'), setAuthModal('register')); }} 
          onLogin={(track) => { localStorage.setItem('skillbridge_selected_track', track); setAuthDestination('dashboard'); setAuthModal('login'); }} 
          onRegister={(track) => { localStorage.setItem('skillbridge_selected_track', track); setAuthDestination('profile'); setAuthModal('register'); }}
          onExploreMarketplace={() => navigate('marketplace')}
        />
      ) : (
        <div className="flex h-screen overflow-hidden relative">
          <Sidebar currentView={currentView} onNavigate={navigate} onLogout={() => { if (localAuthMode) { localStorage.removeItem('skillbridge_preview_session'); setUser(null); } else { signOut(auth); } navigate('landing'); }} />
          <main className="flex-1 overflow-y-auto bg-[#0B1020] p-6 lg:p-12 relative">
             <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-[#3B82F6] opacity-[0.03] blur-[150px] rounded-full pointer-events-none"></div>
             
             <div className="relative z-10 h-full">
              {loadingData ? (
                <div className="flex h-full items-center justify-center"><Loader2 className="w-10 h-10 text-[#3B82F6] animate-spin" /></div>
              ) : (
                <>
                  {currentView === 'dashboard' && <Dashboard user={user} userData={userData} onNavigate={navigate} />}
                  {currentView === 'profile' && <ProfileEditor user={user} userData={userData} onSaved={(patch) => setUserData(previous => ({ ...previous, ...patch }))} onComplete={() => navigate('dashboard')} />}
                  {currentView === 'market' && <JobMarket user={user} userData={userData} onNavigate={navigate} />}
                  {currentView === 'marketplace' && <MarketplaceHub />}
                  {currentView.startsWith('analysis-') && <SpecificAnalysis user={user} userData={userData} jobId={currentView.replace('analysis-', '')} onNavigate={navigate} />}
                </>
              )}
            </div>
          </main>
          
          {/* Global AI Chatbot */}
          <AIChatbot userData={userData} />
        </div>
      )}
    </div>
  );
}

const marketplaceJobsSeed = [
  {id:'j1',title:'Build a responsive portfolio site in React',company:'Northstar Studio',category:'Development & IT',description:'Create a polished five-page portfolio with accessible components and responsive layouts.',skills:['React','TypeScript','Tailwind CSS'],budget:1200,type:'Fixed price',level:'Intermediate',proposals:8,posted:'2 hours ago'},
  {id:'j2',title:'Plan a launch campaign for a productivity app',company:'Mosaic Labs',category:'Sales & Marketing',description:'Plan a four-week launch across email, social content, and performance reporting.',skills:['Content Strategy','Email Marketing','Analytics'],budget:38,type:'Hourly',level:'Intermediate',proposals:12,posted:'5 hours ago'},
  {id:'j3',title:'Design a brand identity for a coffee shop',company:'Juniper Coffee',category:'Design & Creative',description:'Create a logo suite, color palette, typography, and social templates.',skills:['Brand Design','Figma','Illustration'],budget:850,type:'Fixed price',level:'Entry level',proposals:5,posted:'1 day ago'},
  {id:'j4',title:'Build a customer support data dashboard',company:'BrightPath',category:'Data & Analytics',description:'Clean a support dataset and build a dashboard for response times and satisfaction.',skills:['SQL','Data Visualization','Google Sheets'],budget:32,type:'Hourly',level:'Entry level',proposals:6,posted:'1 day ago'}
];
const marketplaceTalentSeed = [
  {id:'t1',name:'Avery Chen',title:'Frontend Developer | React & TypeScript',location:'Toronto, Canada',rate:62,rating:4.9,projects:34,skills:['React','TypeScript','Accessibility'],intro:'I turn product ideas into fast, accessible interfaces and clear component systems.'},
  {id:'t2',name:'Samira Patel',title:'Brand Designer & Illustrator',location:'Pune, India',rate:48,rating:5.0,projects:27,skills:['Brand Design','Figma','Illustration'],intro:'Thoughtful visual identities for early-stage teams and independent businesses.'},
  {id:'t3',name:'Jordan Lee',title:'Growth Marketer | Lifecycle & Content',location:'Austin, United States',rate:55,rating:4.8,projects:41,skills:['Email Marketing','Analytics','Content Strategy'],intro:'Practical campaigns that connect customer insight to measurable growth.'},
  {id:'t4',name:'Nia Okafor',title:'Data Analyst | SQL & Dashboards',location:'Lagos, Nigeria',rate:42,rating:4.9,projects:19,skills:['SQL','Data Visualization','Google Sheets'],intro:'I make messy operational data easier to understand and act on.'}
];
const marketplaceServices = [
  {id:'s1',title:'I will build a responsive React landing page',creator:'Avery Chen',category:'Development & IT',price:450,days:5,skills:['React','Responsive design','Accessibility']},
  {id:'s2',title:'I will design a memorable brand starter kit',creator:'Samira Patel',category:'Design & Creative',price:280,days:4,skills:['Logo','Color palette','Social templates']},
  {id:'s3',title:'I will set up your welcome email sequence',creator:'Jordan Lee',category:'Sales & Marketing',price:220,days:3,skills:['Email','Copywriting','Automation']},
  {id:'s4',title:'I will turn your spreadsheet into a dashboard',creator:'Nia Okafor',category:'Data & Analytics',price:190,days:3,skills:['SQL','Charts','Reporting']}
];
function useMarketplaceState(key, initialValue) {
  const [value,setValue]=useState(()=>{try{return JSON.parse(localStorage.getItem('skillbridge-market-'+key)) ?? initialValue;}catch{return initialValue;}});
  useEffect(()=>{try{localStorage.setItem('skillbridge-market-'+key,JSON.stringify(value));}catch{}},[key,value]);
  return [value,setValue];
}
function MarketplaceHub() {
  const [mode,setMode]=useState('freelancer');
  const [jobs,setJobs]=useMarketplaceState('jobs',marketplaceJobsSeed);
  const [proposals,setProposals]=useMarketplaceState('proposals',[]);
  const [saved,setSaved]=useMarketplaceState('saved',[]);
  const [contracts,setContracts]=useMarketplaceState('contracts',[]);
  const [threads,setThreads]=useMarketplaceState('threads',[]);
  const [tab,setTab]=useState('jobs');
  const [search,setSearch]=useState('');
  const [category,setCategory]=useState('All categories');
  const [jobType,setJobType]=useState('Any payment type');
  const [notice,setNotice]=useState('');
  const [modal,setModal]=useState('');
  const [selected,setSelected]=useState(null);
  const [cover,setCover]=useState('');
  const [bid,setBid]=useState('');
  const [draft,setDraft]=useState({title:'',description:'',skills:'',budget:'',category:'Development & IT',type:'Fixed price'});
  const [message,setMessage]=useState('');
  const cats=['All categories','Development & IT','Design & Creative','Sales & Marketing','Data & Analytics','Writing & Content','Admin & Support'];
  const tabs=mode==='freelancer'?[['jobs','Find work'],['services','Project catalog'],['proposals','My proposals'],['messages','Messages'],['contracts','Contracts']]:[['talent','Find talent'],['post','Post a job'],['services','Project catalog'],['messages','Messages'],['contracts','Contracts']];
  const ping=(text)=>{setNotice(text);window.setTimeout(()=>setNotice(''),3000);};
  const match=(x)=>[x.title,x.description,x.intro,x.name,(x.skills||[]).join(' ')].filter(Boolean).join(' ').toLowerCase().includes(search.toLowerCase())&&(category==='All categories'||x.category===category);
  const jobsShown=jobs.filter(x=>match(x)&&(jobType==='Any payment type'||x.type===jobType));
  const talentShown=marketplaceTalentSeed.filter(match);
  const servicesShown=marketplaceServices.filter(match);
  const apply=(job)=>{setSelected(job);setCover('');setBid(String(job.budget));setModal('apply');};
  const sendProposal=(e)=>{e.preventDefault();if(!cover.trim())return;setProposals([{id:'p'+Date.now(),job:selected.title,company:selected.company,cover:cover.trim(),bid:Number(bid)||selected.budget,type:selected.type,status:'Submitted'},...proposals]);setModal('');ping('Proposal saved to My proposals.');};
  const postJob=(e)=>{e.preventDefault();const job={...draft,id:'j'+Date.now(),company:'Your workspace',skills:draft.skills.split(',').map(x=>x.trim()).filter(Boolean),budget:Number(draft.budget)||0,level:'Open to all levels',proposals:0,posted:'Just now'};setJobs([job,...jobs]);setDraft({title:'',description:'',skills:'',budget:'',category:'Development & IT',type:'Fixed price'});setTab('talent');ping('Job post published in this local preview.');};
  const messageTalent=(person)=>{let th=threads.find(x=>x.personId===person.id);if(!th)th={id:'m'+person.id,personId:person.id,person:person.name,title:person.title,entries:[{from:'them',text:'Hi! Thanks for reaching out. What would you like to work on?'}]};setThreads([th,...threads.filter(x=>x.id!==th.id)]);setSelected(th);setTab('messages');};
  const sendMessage=(e)=>{e.preventDefault();if(!message.trim())return;let th=selected||threads[0]||{id:'general',person:'Project inquiry',title:'Marketplace conversation',entries:[]};const updated={...th,entries:[...(th.entries||[]),{from:'you',text:message.trim()}]};setThreads([updated,...threads.filter(x=>x.id!==updated.id)]);setSelected(updated);setMessage('');};
  const createOffer=(person)=>{setContracts([{id:'c'+Date.now(),title:person.title,partner:person.name,budget:person.rate,type:'Hourly',status:'Offer drafted'},...contracts]);messageTalent(person);ping('Draft offer added to Contracts.');};
  const buyService=(service)=>{setContracts([{id:'c'+Date.now(),title:service.title,partner:service.creator,budget:service.price,type:'Fixed price',status:'Order requested'},...contracts]);ping('Order request added. Payment is disabled in this preview.');};
  const toggleSave=(item)=>{const id=item.id;setSaved(saved.includes(id)?saved.filter(x=>x!==id):[id,...saved]);ping(saved.includes(id)?'Removed from saved items.':'Saved for later.');};

  return <div className="max-w-7xl mx-auto pb-16">
    <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-5 mb-7"><div><p className="text-xs text-[#60A5FA] uppercase font-bold tracking-widest mb-2">SkillBridge Marketplace · Preview</p><h1 className="text-4xl font-bold text-white">Find work that moves you forward</h1><p className="text-slate-400 mt-2">Discover projects, meet skilled people, and manage proposals together.</p></div><div className="flex bg-[#0B1020] border border-[#192440] p-1 rounded-xl"><button onClick={()=>{setMode('freelancer');setTab('jobs');}} className={'px-4 py-2 rounded-lg text-sm '+(mode==='freelancer'?'bg-[#3B82F6] text-white':'text-slate-400')}>Find work</button><button onClick={()=>{setMode('client');setTab('talent');}} className={'px-4 py-2 rounded-lg text-sm '+(mode==='client'?'bg-[#3B82F6] text-white':'text-slate-400')}>Hire talent</button></div></header>
    {notice&&<div role="status" className="mb-5 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm">{notice}</div>}
    <nav className="flex gap-2 overflow-x-auto border-b border-[#192440] mb-6">{tabs.map(([id,label])=><button key={id} onClick={()=>setTab(id)} className={'whitespace-nowrap px-4 py-3 border-b-2 text-sm font-semibold '+(tab===id?'border-[#3B82F6] text-white':'border-transparent text-slate-400')}>{label}{id==='proposals'&&proposals.length?' ('+proposals.length+')':''}</button>)}</nav>
    {['jobs','talent','services'].includes(tab)&&<div className="flex flex-col md:flex-row gap-3 mb-6"><div className="flex-1 relative"><Search className="absolute left-4 top-3.5 text-slate-500" size={18}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search jobs, people, or skills" className="w-full bg-[#121A2F] border border-[#192440] rounded-xl pl-11 pr-4 py-3 text-white"/></div><select value={category} onChange={e=>setCategory(e.target.value)} className="bg-[#121A2F] border border-[#192440] rounded-xl px-4 py-3 text-white">{cats.map(x=><option key={x}>{x}</option>)}</select>{tab==='jobs'&&<select value={jobType} onChange={e=>setJobType(e.target.value)} className="bg-[#121A2F] border border-[#192440] rounded-xl px-4 py-3 text-white"><option>Any payment type</option><option>Hourly</option><option>Fixed price</option></select>}</div>}
    {tab==='jobs'&&<div className="space-y-4">{jobsShown.map(job=><article key={job.id} className="bg-[#121A2F] border border-[#192440] rounded-2xl p-6"><div className="flex flex-col md:flex-row justify-between gap-5"><div className="flex-1"><p className="text-xs text-[#60A5FA] font-bold uppercase">{job.category} · {job.posted}</p><h2 className="text-xl font-bold text-white mt-2">{job.title}</h2><p className="text-sm text-slate-400 mt-1">{job.company} · {job.level} · {job.proposals} proposals</p><p className="text-sm text-slate-300 mt-4">{job.description}</p><div className="flex flex-wrap gap-2 mt-4">{job.skills.map(skill=><span key={skill} className="text-xs bg-[#0B1020] border border-[#192440] px-3 py-1 rounded-full text-slate-300">{skill}</span>)}</div></div><div className="md:w-48 flex md:flex-col justify-between gap-3"><div><strong className="text-white">{job.type==='Hourly'?'$'+job.budget+'/hr':'$'+job.budget}</strong><p className="text-xs text-slate-500">{job.type}</p></div><button onClick={()=>toggleSave(job)} className="border border-[#334155] text-white rounded-full px-4 py-2 text-sm">{saved.includes(job.id)?'Saved':'Save'}</button><button onClick={()=>apply(job)} className="bg-[#3B82F6] text-white rounded-full px-4 py-2 text-sm font-bold">Send proposal</button></div></div></article>)}{!jobsShown.length&&<EmptyMarketplace text="No projects match your filters."/>}</div>}
    {tab==='talent'&&<div className="grid md:grid-cols-2 gap-4">{talentShown.map(p=><article key={p.id} className="bg-[#121A2F] border border-[#192440] rounded-2xl p-6"><div className="flex justify-between"><div><h2 className="text-lg text-white font-bold">{p.name}</h2><p className="text-sm text-slate-300">{p.title}</p><p className="text-xs text-slate-500 mt-1">{p.location}</p></div><button onClick={()=>toggleSave(p)} className="text-sm text-slate-300">{saved.includes(p.id)?'Saved':'♡ Save'}</button></div><p className="text-sm text-slate-400 mt-4">{p.intro}</p><div className="flex flex-wrap gap-2 mt-4">{p.skills.map(x=><span key={x} className="text-xs bg-[#0B1020] border border-[#192440] px-3 py-1 rounded-full text-slate-300">{x}</span>)}</div><div className="flex justify-between border-t border-[#192440] mt-5 pt-4 text-sm"><span className="text-amber-300">★ {p.rating} · {p.projects} projects</span><strong className="text-white">{'$'+p.rate}/hr</strong></div><div className="flex gap-2 mt-4"><button onClick={()=>messageTalent(p)} className="flex-1 border border-[#334155] text-white rounded-full py-2 text-sm">Message</button><button onClick={()=>createOffer(p)} className="flex-1 bg-[#3B82F6] text-white rounded-full py-2 text-sm font-bold">Create offer</button></div></article>)}</div>}
    {tab==='services'&&<div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{servicesShown.map(service=><article key={service.id} className="bg-[#121A2F] border border-[#192440] rounded-2xl p-5"><p className="text-xs text-[#60A5FA]">{service.category} · By {service.creator}</p><h2 className="text-lg text-white font-bold mt-3">{service.title}</h2><p className="text-sm text-slate-400 mt-3">{service.skills.join(' · ')}</p><div className="flex justify-between border-t border-[#192440] mt-5 pt-4 text-sm text-slate-400"><span>{service.days} day delivery</span><strong className="text-white">{'$'+service.price}</strong></div><button onClick={()=>buyService(service)} className="w-full mt-4 rounded-full bg-[#3B82F6] text-white py-2 font-bold text-sm">Request project</button></article>)}</div>}
    {tab==='post'&&<form onSubmit={postJob} className="max-w-3xl bg-[#121A2F] border border-[#192440] rounded-2xl p-7 space-y-5"><h2 className="text-2xl text-white font-bold">Post a project</h2><label className="block text-sm text-slate-300">Title<input required value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})} className="block w-full mt-2 bg-[#0B1020] border border-[#334155] rounded-xl p-3 text-white"/></label><label className="block text-sm text-slate-300">Description<textarea required minLength={20} value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})} rows={4} className="block w-full mt-2 bg-[#0B1020] border border-[#334155] rounded-xl p-3 text-white"/></label><label className="block text-sm text-slate-300">Category<select value={draft.category} onChange={e=>setDraft({...draft,category:e.target.value})} className="block w-full mt-2 bg-[#0B1020] border border-[#334155] rounded-xl p-3 text-white">{cats.slice(1).map(x=><option key={x}>{x}</option>)}</select></label><label className="block text-sm text-slate-300">Skills, comma separated<input value={draft.skills} onChange={e=>setDraft({...draft,skills:e.target.value})} className="block w-full mt-2 bg-[#0B1020] border border-[#334155] rounded-xl p-3 text-white"/></label><div className="grid sm:grid-cols-2 gap-4"><label className="block text-sm text-slate-300">Budget (USD)<input required min="1" type="number" value={draft.budget} onChange={e=>setDraft({...draft,budget:e.target.value})} className="block w-full mt-2 bg-[#0B1020] border border-[#334155] rounded-xl p-3 text-white"/></label><label className="block text-sm text-slate-300">Payment type<select value={draft.type} onChange={e=>setDraft({...draft,type:e.target.value})} className="block w-full mt-2 bg-[#0B1020] border border-[#334155] rounded-xl p-3 text-white"><option>Fixed price</option><option>Hourly</option></select></label></div><button className="bg-[#3B82F6] text-white rounded-full px-6 py-3 font-bold">Publish job</button></form>}
    {tab==='proposals'&&<div className="space-y-4">{proposals.map(p=><article key={p.id} className="bg-[#121A2F] border border-[#192440] rounded-2xl p-6"><h2 className="text-white font-bold">{p.job}</h2><p className="text-sm text-slate-400">{p.company} · {p.status} · {'$'+p.bid}{p.type==='Hourly'?'/hr':''}</p><p className="text-sm text-slate-300 mt-3">{p.cover}</p></article>)}{!proposals.length&&<EmptyMarketplace text="Proposals you submit will appear here."/>}</div>}
    {tab==='messages'&&<div className="grid md:grid-cols-[250px_1fr] min-h-96 bg-[#121A2F] border border-[#192440] rounded-2xl overflow-hidden"><div className="p-4 border-r border-[#192440]"><h2 className="font-bold text-white mb-3">Conversations</h2>{threads.map(th=><button key={th.id} onClick={()=>setSelected(th)} className="block w-full text-left p-3 rounded-xl text-white hover:bg-[#0B1020]">{th.person}<span className="block text-xs text-slate-500 truncate">{th.title}</span></button>)}{!threads.length&&<p className="text-xs text-slate-500">Open a talent profile to start a conversation.</p>}</div><div className="p-5 flex flex-col"><h2 className="font-bold text-white border-b border-[#192440] pb-3">{selected?.person||threads[0]?.person||'Messages'}</h2><div className="flex-1 py-4 space-y-3">{(selected?.entries||threads[0]?.entries||[]).map((entry,i)=><p key={i} className={'rounded-xl p-3 text-sm max-w-[80%] '+(entry.from==='you'?'ml-auto bg-[#3B82F6] text-white':'bg-[#0B1020] text-slate-200')}>{entry.text}</p>)}</div><form onSubmit={sendMessage} className="flex gap-2 border-t border-[#192440] pt-4"><input value={message} onChange={e=>setMessage(e.target.value)} placeholder="Write a message" className="flex-1 bg-[#0B1020] border border-[#334155] rounded-full px-4 text-white"/><button className="bg-[#3B82F6] text-white p-3 rounded-full"><Send size={16}/></button></form></div></div>}
    {tab==='contracts'&&<div className="space-y-4">{contracts.map(c=><article key={c.id} className="bg-[#121A2F] border border-[#192440] rounded-2xl p-6 flex justify-between gap-4"><div><h2 className="font-bold text-white">{c.title}</h2><p className="text-sm text-slate-400 mt-1">With {c.partner} · {c.type}</p></div><div className="text-right"><strong className="text-white">{'$'+c.budget}{c.type==='Hourly'?'/hr':''}</strong><p className="text-xs text-amber-300">{c.status}</p></div></article>)}{!contracts.length&&<EmptyMarketplace text="Offers and project orders will be tracked here."/>}</div>}
    {modal==='apply'&&selected&&<div className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4"><form onSubmit={sendProposal} className="w-full max-w-xl bg-[#121A2F] border border-[#334155] rounded-2xl p-7"><div className="flex justify-between"><div><p className="text-xs text-[#60A5FA] font-bold uppercase">Proposal</p><h2 className="text-xl text-white font-bold mt-1">{selected.title}</h2></div><button type="button" onClick={()=>setModal('')} className="text-slate-400">Close</button></div><label className="block text-sm text-slate-300 mt-5">Cover letter<textarea required minLength={20} rows={5} value={cover} onChange={e=>setCover(e.target.value)} className="block w-full mt-2 bg-[#0B1020] border border-[#334155] rounded-xl p-3 text-white"/></label><label className="block text-sm text-slate-300 mt-4">Your bid (USD)<input required min="1" type="number" value={bid} onChange={e=>setBid(e.target.value)} className="block w-full mt-2 bg-[#0B1020] border border-[#334155] rounded-xl p-3 text-white"/></label><button className="mt-5 bg-[#3B82F6] text-white rounded-full px-6 py-2.5 font-bold">Submit proposal</button><p className="text-xs text-slate-500 mt-4">Local preview only. No proposal is sent to a real client.</p></form></div>}
    <p className="text-xs text-slate-600 mt-8">Demo content is fictional. Marketplace activity is saved in this browser; no payment or real account activity is connected.</p>
  </div>;
}
function EmptyMarketplace({text}) { return <div className="rounded-2xl border border-dashed border-[#334155] p-10 text-center text-slate-400">{text}</div>; }
// --- Subcomponents ---

const DEMO_ACCOUNT_EMAIL = 'demo@skillbridge.local';
const DEMO_ACCOUNT_PASSWORD = 'SkillBridge123!';

function AuthModal({ type, localMode, destination = 'dashboard', onAuthenticated, onClose, onSwitch, onNavigate }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const auth = localMode ? null : getAuth(app);
  const openSampleAccount = async () => {
    setLoading(true); setError('');
    try {
      const accounts = JSON.parse(localStorage.getItem('skillbridge_preview_accounts') || '{}');
      const uid = 'local-sample-account';
      const salt = 'skillbridge-demo-salt';
      const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + DEMO_ACCOUNT_PASSWORD));
      const passwordHash = Array.from(new Uint8Array(hashBuffer), byte => byte.toString(16).padStart(2, '0')).join('');
      const demoUser = { uid, email: DEMO_ACCOUNT_EMAIL };
      accounts[DEMO_ACCOUNT_EMAIL] = { salt, passwordHash, user: demoUser };
      localStorage.setItem('skillbridge_preview_accounts', JSON.stringify(accounts));
      const sample = exampleProfiles[0];
      const sampleProfile = { ...emptyUserProfile(), ...sample, skills: sample.skills.split(',').map(skill => skill.trim()).filter(Boolean) };
      localStorage.setItem(localProfileKey(uid), JSON.stringify(sampleProfile));
      onAuthenticated(demoUser); onClose(); onNavigate(destination);
    } catch (err) { setError(err.message || 'Could not open the sample account.'); }
    finally { setLoading(false); }
  };
  const handleSubmit = async (e) => {
    e.preventDefault(); setLoading(true); setError('');
    const normalizedEmail = email.trim().toLowerCase();
    try {
      if (localMode) {
        const accounts = JSON.parse(localStorage.getItem('skillbridge_preview_accounts') || '{}');
        if (type === 'register') {
          if (accounts[normalizedEmail]) throw new Error('An account with this email already exists. Log in instead.');
          const nextUser = { uid: 'local-' + crypto.randomUUID(), email: normalizedEmail };
          const salt = crypto.randomUUID();
          const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + password));
          const passwordHash = Array.from(new Uint8Array(hashBuffer), byte => byte.toString(16).padStart(2, '0')).join('');
          accounts[normalizedEmail] = { salt, passwordHash, user: nextUser };
          localStorage.setItem('skillbridge_preview_accounts', JSON.stringify(accounts)); onAuthenticated(nextUser);
        } else {
          const account = accounts[normalizedEmail];
          if (!account) throw new Error('Email or password is incorrect. Create an account if you are new here.');
          const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(account.salt + password));
          const passwordHash = Array.from(new Uint8Array(hashBuffer), byte => byte.toString(16).padStart(2, '0')).join('');
          if (passwordHash !== account.passwordHash) throw new Error('Email or password is incorrect. Create an account if you are new here.');
          onAuthenticated(account.user);
        }
      } else if (type === 'register') {
        const credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password); onAuthenticated(credential.user);
      } else {
        const credential = await signInWithEmailAndPassword(auth, normalizedEmail, password); onAuthenticated(credential.user);
      }
      onClose(); onNavigate(destination);
    } catch (err) { setError(localMode ? err.message : err.message.replace('Firebase: ', '')); }
    finally { setLoading(false); }
  };
  return (
    <div className="fixed inset-0 bg-[#0B1020]/85 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-[#121A2F] border border-[#263554] rounded-3xl p-8 w-full max-w-md relative shadow-2xl">
        <button aria-label="Close" onClick={onClose} className="absolute top-6 right-6 text-slate-400 hover:text-white"><X size={20}/></button>
        <div className="w-12 h-12 rounded-2xl bg-[#3B82F6]/15 text-[#60A5FA] flex items-center justify-center mb-5"><BrainCircuit size={24}/></div>
        <h2 className="text-3xl font-bold text-white mb-2">{type === 'register' ? 'Create your account' : 'Welcome back'}</h2>
        <p className="text-slate-400 text-sm mb-6">{type === 'register' ? 'Save your career profile and build a focused plan.' : 'Log in to return to your career dashboard.'}</p>
        {localMode && <div className="rounded-xl border border-sky-400/20 bg-sky-400/5 px-4 py-3 mb-4"><p className="text-xs text-sky-200">Preview accounts are saved only in this browser.</p><div className="mt-2 text-xs text-slate-300"><span className="text-slate-500">Sample email:</span> {DEMO_ACCOUNT_EMAIL}<br/><span className="text-slate-500">Sample password:</span> {DEMO_ACCOUNT_PASSWORD}</div><button type="button" onClick={openSampleAccount} disabled={loading} className="mt-3 w-full rounded-lg border border-sky-300/30 px-3 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-300/10 disabled:opacity-60">{loading ? 'Opening sample account…' : 'Use sample account'}</button></div>}
        {error && <div role="alert" className="p-3 bg-red-500/10 border border-red-500/50 rounded-xl text-red-300 text-sm mb-4">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div><label htmlFor="account-email" className="block text-sm font-medium text-slate-300 mb-1.5">Email address</label><input id="account-email" type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required className="w-full bg-[#0B1020] border border-[#2A3855] rounded-xl px-4 py-3.5 text-white focus:outline-none focus:border-[#60A5FA]" /></div>
          <div><label htmlFor="account-password" className="block text-sm font-medium text-slate-300 mb-1.5">Password</label><input id="account-password" type="password" autoComplete={type === 'register' ? 'new-password' : 'current-password'} value={password} onChange={e=>setPassword(e.target.value)} minLength={6} required className="w-full bg-[#0B1020] border border-[#2A3855] rounded-xl px-4 py-3.5 text-white focus:outline-none focus:border-[#60A5FA]" />{type === 'register' && <p className="text-xs text-slate-500 mt-1.5">Use at least 6 characters.</p>}</div>
          <button type="submit" disabled={loading} className="w-full bg-[#3B82F6] hover:bg-[#60A5FA] disabled:opacity-60 text-white py-3.5 rounded-xl font-bold transition-colors flex justify-center items-center gap-2 mt-6">{loading ? <Loader2 size={18} className="animate-spin" /> : (type === 'register' ? 'Create account' : 'Log in')}</button>
        </form>
        <p className="text-center text-sm text-slate-400 mt-6">{type === 'register' ? 'Already have an account?' : 'New to SkillBridge?'} <button onClick={onSwitch} className="text-[#93C5FD] hover:text-white font-semibold">{type === 'register' ? 'Log in' : 'Create account'}</button></p>
      </div>
    </div>
  );
}
const careerMentors = [
 {name:'Aisha Khan',role:'AI & Machine Learning Mentor',rating:4.9,reviewCount:128,rate:'$85/hr+',img:'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=500&q=85',domain:'AI Services',exp:'7+ Years',teachTime:'6 Weeks',skills:['Machine Learning','Python','TensorFlow','Deep Learning'],review:'Aisha made complex machine-learning concepts practical and gave me a clear project plan.'},
 {name:'Noah Williams',role:'Applied AI Mentor',rating:5.0,reviewCount:61,rate:'$95/hr+',img:'https://images.unsplash.com/photo-1547425260-76bcadfb4f2c?auto=format&fit=crop&w=500&q=85',domain:'AI Services',exp:'9+ Years',teachTime:'7 Weeks',skills:['Python','LLMs','Prompt Engineering','Natural Language Processing'],review:'Noah helped me build a working AI portfolio project from a rough idea.'},
 {name:'Marcus Lee',role:'Software Development Mentor',rating:4.9,reviewCount:96,rate:'$75/hr+',img:'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=500&q=85',domain:'Development & IT',exp:'8+ Years',teachTime:'8 Weeks',skills:['React','TypeScript','JavaScript','Node.js'],review:'The code reviews were detailed, kind, and focused on skills employers ask for.'},
 {name:'Sofia Patel',role:'Full-Stack Developer Mentor',rating:4.9,reviewCount:88,rate:'$82/hr+',img:'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=500&q=85',domain:'Development & IT',exp:'7+ Years',teachTime:'8 Weeks',skills:['React','Node.js','APIs','Cloud basics'],review:'Sofia gave me a realistic plan and helped me ship my first full-stack app.'},
 {name:'Elena Rossi',role:'Product & Visual Design Mentor',rating:4.8,reviewCount:74,rate:'$70/hr+',img:'https://images.unsplash.com/photo-1531123897727-8f129e1bf98a?auto=format&fit=crop&w=500&q=85',domain:'Design & Creative',exp:'6+ Years',teachTime:'5 Weeks',skills:['Figma','UX research','UI design','Prototyping'],review:'I rebuilt my portfolio with Elena and learned to explain my design decisions.'},
 {name:'Camila Torres',role:'Brand & UX Mentor',rating:4.9,reviewCount:57,rate:'$76/hr+',img:'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=500&q=85',domain:'Design & Creative',exp:'8+ Years',teachTime:'6 Weeks',skills:['Figma','Design systems','Accessibility','UX research'],review:'The portfolio review was honest, encouraging, and full of useful next steps.'},
 {name:'Daniel Brooks',role:'Digital Marketing Mentor',rating:4.8,reviewCount:83,rate:'$68/hr+',img:'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=500&q=85',domain:'Sales & Marketing',exp:'7+ Years',teachTime:'5 Weeks',skills:['Google Ads','SEO','Analytics','Digital marketing'],review:'Daniel helped me turn campaign metrics into a plan I could use at work.'},
 {name:'Ethan Moore',role:'Growth Marketing Mentor',rating:4.9,reviewCount:103,rate:'$78/hr+',img:'https://images.unsplash.com/photo-1504593811423-6dd665756598?auto=format&fit=crop&w=500&q=85',domain:'Sales & Marketing',exp:'9+ Years',teachTime:'6 Weeks',skills:['Content strategy','Email marketing','Analytics','SEO'],review:'Ethan connected strategy to measurable outcomes and helped me present results.'},
 {name:'Priya Nair',role:'Writing & Editorial Mentor',rating:4.9,reviewCount:111,rate:'$58/hr+',img:'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=500&q=85',domain:'Writing & Translation',exp:'6+ Years',teachTime:'4 Weeks',skills:['Copywriting','Editing','SEO writing','Technical writing'],review:'Specific feedback helped me make my writing samples much stronger.'},
 {name:'Lina Haddad',role:'Localization & Translation Mentor',rating:4.8,reviewCount:49,rate:'$64/hr+',img:'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=500&q=85',domain:'Writing & Translation',exp:'7+ Years',teachTime:'5 Weeks',skills:['Localization','Editing','Research','Technical writing'],review:'Lina helped me shape a strong multilingual writing portfolio.'},
 {name:'Samuel Okafor',role:'Operations & Admin Mentor',rating:4.7,reviewCount:52,rate:'$52/hr+',img:'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=500&q=85',domain:'Admin & Support',exp:'5+ Years',teachTime:'4 Weeks',skills:['Customer support','Project coordination','CRM tools'],review:'Samuel shared practical systems for managing projects and supporting customers.'},
 {name:'Amara Johnson',role:'Customer Success Mentor',rating:4.9,reviewCount:76,rate:'$59/hr+',img:'https://images.unsplash.com/photo-1551836022-d5d88e9218df?auto=format&fit=crop&w=500&q=85',domain:'Admin & Support',exp:'8+ Years',teachTime:'5 Weeks',skills:['Customer support','Communication','CRM tools'],review:'Amara shared templates and practice scenarios I could use right away.'},
 {name:'Mei Chen',role:'Finance & Accounting Mentor',rating:4.8,reviewCount:68,rate:'$72/hr+',img:'https://images.unsplash.com/photo-1534751516642-a1af1ef26a56?auto=format&fit=crop&w=500&q=85',domain:'Finance & Accounting',exp:'9+ Years',teachTime:'7 Weeks',skills:['Bookkeeping','Excel','Financial analysis','QuickBooks'],review:'Mei explained financial reporting in a clear, step-by-step way.'},
 {name:'Oliver Grant',role:'Financial Analysis Mentor',rating:4.9,reviewCount:91,rate:'$88/hr+',img:'https://images.unsplash.com/photo-1521119989659-a83eee488004?auto=format&fit=crop&w=500&q=85',domain:'Finance & Accounting',exp:'11+ Years',teachTime:'8 Weeks',skills:['Excel','Financial analysis','Forecasting','Bookkeeping'],review:'Oliver made forecasting approachable with practical examples.'},
 {name:'Isabella Moretti',role:'People & Learning Mentor',rating:4.8,reviewCount:63,rate:'$70/hr+',img:'https://images.unsplash.com/photo-1548142813-c348350df52b?auto=format&fit=crop&w=500&q=85',domain:'HR & Training',exp:'9+ Years',teachTime:'6 Weeks',skills:['Recruiting','People operations','Instructional design','Facilitation'],review:'Isabella helped turn my training experience into a learning-design portfolio.'},
 {name:'Rafael Costa',role:'Legal Careers Mentor',rating:4.8,reviewCount:45,rate:'$90/hr+',img:'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=500&q=85',domain:'Legal',exp:'10+ Years',teachTime:'8 Weeks',skills:['Legal research','Contract review','Compliance'],review:'Rafael helped me organize my experience and prepare thoughtful interviews.'}
];

function getRecommendedMentors(missingSkills=[]) {
  const normalize=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const gaps=missingSkills.map(normalize).filter(Boolean);
  const ranked=careerMentors.map(mentor=>{const matchedGapSkills=mentor.skills.filter(skill=>gaps.some(gap=>normalize(skill).includes(gap)||gap.includes(normalize(skill))));return {...mentor,matchedGapSkills,matchScore:matchedGapSkills.length};});
  const exact=ranked.filter(mentor=>mentor.matchScore>0);
  const mentors=(exact.length?exact:ranked).sort((a,b)=>b.matchScore-a.matchScore||b.rating-a.rating||b.reviewCount-a.reviewCount).slice(0,3);
  return {mentors,hasSkillMatches:exact.length>0};
}

function SpecialistsSection() {
  const categories=['AI Services','Development & IT','Design & Creative','Sales & Marketing','Writing & Translation','Admin & Support','Finance & Accounting','HR & Training','Legal'];
  const [activeCat,setActiveCat]=useState('AI Services'); const [selectedSpecialist,setSelectedSpecialist]=useState(null);
  const visibleSpecialists=careerMentors.filter(mentor=>mentor.domain===activeCat);
  return <section id="specialists" className="max-w-[1400px] mx-auto px-8 py-24"><p className="text-xs font-bold uppercase tracking-[0.2em] text-[#60A5FA] mb-3">Practical guidance from people in the field</p><h2 className="text-4xl font-bold mb-4 text-white">Learn from Top Mentors & Specialists</h2><p className="text-slate-400 mb-9">Browse {careerMentors.length} mentors across nine departments. Ratings and reviews are sample preview content.</p>
    <div className="flex flex-wrap gap-3 mb-10">{categories.map(category=><button key={category} onClick={()=>setActiveCat(category)} className={'px-5 py-3 rounded-xl border text-sm font-medium '+(activeCat===category?'bg-white text-[#0B1020] border-white':'bg-[#121A2F] text-slate-300 border-[#192440] hover:border-[#3B82F6]')}>{category}</button>)}</div>
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">{visibleSpecialists.map(mentor=><button type="button" key={mentor.name} onClick={()=>setSelectedSpecialist(mentor)} className="group text-left bg-[#121A2F] border border-[#192440] p-5 rounded-2xl hover:border-[#3B82F6] transition-all"><div className="flex gap-4 items-center"><img src={mentor.img} alt={mentor.name} className="w-16 h-16 rounded-xl object-cover"/><div className="min-w-0"><p className="font-bold text-white truncate">{mentor.name}</p><p className="text-xs text-slate-400 line-clamp-2">{mentor.role}</p><p className="text-amber-300 text-xs mt-1">★ {mentor.rating.toFixed(1)} <span className="text-slate-500">· {mentor.reviewCount} reviews</span></p></div></div><p className="text-sm text-slate-400 leading-relaxed mt-4 line-clamp-2">“{mentor.review}”</p><div className="flex flex-wrap gap-1.5 mt-4">{mentor.skills.slice(0,3).map(skill=><span key={skill} className="text-[11px] bg-[#0B1020] text-slate-300 border border-[#192440] px-2 py-1 rounded-full">{skill}</span>)}</div><p className="text-xs text-[#60A5FA] mt-4">View mentor and reviews →</p></button>)}</div>
    {selectedSpecialist&&<div className="fixed inset-0 bg-[#0B1020]/80 backdrop-blur-sm z-[90] flex items-center justify-center p-4" onClick={()=>setSelectedSpecialist(null)}><div role="dialog" aria-modal="true" className="bg-[#121A2F] border border-[#192440] rounded-3xl p-8 w-full max-w-xl relative shadow-2xl" onClick={event=>event.stopPropagation()}><button aria-label="Close mentor details" onClick={()=>setSelectedSpecialist(null)} className="absolute top-6 right-6 text-slate-400"><X size={20}/></button><div className="flex items-center gap-5 mb-6"><img src={selectedSpecialist.img} alt={selectedSpecialist.name} className="w-20 h-20 rounded-2xl object-cover"/><div><h3 className="text-xl font-bold text-white">{selectedSpecialist.name}</h3><p className="text-slate-400 text-sm">{selectedSpecialist.role}</p><p className="text-amber-300 text-sm mt-1">★ {selectedSpecialist.rating.toFixed(1)} · {selectedSpecialist.reviewCount} learner reviews</p></div></div><div className="bg-[#0B1020] p-5 rounded-2xl border border-[#192440] mb-5"><p className="text-xs uppercase tracking-wide font-bold text-slate-500 mb-2">Learner review · preview</p><p className="text-slate-200 leading-relaxed">“{selectedSpecialist.review}”</p></div><div className="flex flex-wrap gap-2 mb-6">{selectedSpecialist.skills.map(skill=><span key={skill} className="text-xs text-slate-300 bg-[#0B1020] border border-[#192440] px-3 py-1.5 rounded-full">{skill}</span>)}</div><div className="grid grid-cols-3 gap-3 text-center text-sm mb-6"><div className="bg-[#0B1020] rounded-xl p-3"><span className="block text-slate-500 text-xs">Experience</span><strong>{selectedSpecialist.exp}</strong></div><div className="bg-[#0B1020] rounded-xl p-3"><span className="block text-slate-500 text-xs">Mentoring</span><strong>{selectedSpecialist.teachTime}</strong></div><div className="bg-[#0B1020] rounded-xl p-3"><span className="block text-slate-500 text-xs">Rate</span><strong>{selectedSpecialist.rate}</strong></div></div><a href="https://www.upwork.com/" target="_blank" rel="noopener noreferrer" className="w-full bg-[#3B82F6] text-white py-3 rounded-xl font-bold flex justify-center items-center gap-2">Connect with Mentor <ExternalLink size={16}/></a></div></div>}
  </section>;
}

const roadmapSkillCatalog = {
  'Development & IT':['JavaScript','React','TypeScript','Node.js','Python','APIs','Git','Cloud basics'],
  'Design & Creative':['Figma','UX research','UI design','Prototyping','Design systems','Accessibility'],
  'Sales & Marketing':['Digital marketing','SEO','Google Ads','Content strategy','Email marketing','Analytics'],
  'Writing & Translation':['Copywriting','Editing','SEO writing','Technical writing','Research','Localization'],
  'Admin & Support':['Customer support','Project coordination','Virtual assistance','CRM tools','Communication'],
  'Finance & Accounting':['Bookkeeping','Excel','Financial analysis','Tax preparation','QuickBooks'],
  'HR & Training':['Recruiting','People operations','Instructional design','Facilitation','Learning management'],
  'AI Services':['Artificial Intelligence','Machine Learning','Python','Deep Learning','Data Science','TensorFlow','Neural Networks','Natural Language Processing','Data Analysis','Computer Vision','Data Mining','Prompt Engineering']
};

function LandingPage({ onGetStarted, onLogin, onRegister, onExploreMarketplace }) {
  const [activeTab, setActiveTab] = useState('hire');
  const [selectedRoadmapCategory, setSelectedRoadmapCategory] = useState('');
  const [selectedRoadmapSkills, setSelectedRoadmapSkills] = useState([]);
  const [customRoadmapSkill, setCustomRoadmapSkill] = useState('');
  const [comparedMentors, setComparedMentors] = useState([]);
  const visibleRoadmapMentors = careerMentors.filter(mentor => mentor.domain === selectedRoadmapCategory && (!selectedRoadmapSkills.length || selectedRoadmapSkills.some(selectedSkill => mentor.skills.some(skill => skill.toLowerCase().includes(selectedSkill.toLowerCase()) || selectedSkill.toLowerCase().includes(skill.toLowerCase())))));
  const isFresherTrack = activeTab === 'work';

  return (
    <div className="flex flex-col min-h-screen overflow-y-auto bg-[#0B1020] text-white scroll-smooth">
      <header className="flex justify-between items-center px-8 py-6 max-w-[1400px] w-full mx-auto z-50 border-b border-[#121A2F]/50 relative">
        <div className="text-2xl font-bold tracking-tight flex items-center gap-2 cursor-pointer" onClick={() => window.scrollTo(0,0)}>
          <BrainCircuit className="text-[#3B82F6]" />
          SkillBridge
        </div>
        <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-300">
          <div className="relative group cursor-pointer py-4">
            <span className="hover:text-white flex items-center gap-1 transition-colors">Find roadmaps <ChevronDown size={14}/></span>
            <div className="absolute top-full left-0 w-[200px] bg-[#121A2F] border border-[#192440] rounded-xl shadow-2xl p-2 hidden group-hover:flex flex-col opacity-0 group-hover:opacity-100 transition-opacity z-50">
              <a href="#roadmaps" className="px-4 py-2 hover:bg-[#192440] hover:text-[#3B82F6] rounded-lg transition-colors">All Categories</a>
              <a href="#roadmaps" className="px-4 py-2 hover:bg-[#192440] hover:text-[#3B82F6] rounded-lg transition-colors">Development & IT</a>
              <a href="#roadmaps" className="px-4 py-2 hover:bg-[#192440] hover:text-[#3B82F6] rounded-lg transition-colors">AI Services</a>
            </div>
          </div>

          <div className="relative group cursor-pointer py-4">
            <span className="hover:text-white flex items-center gap-1 transition-colors">Get outcomes <ChevronDown size={14}/></span>
            <div className="absolute top-full left-[-200px] w-[700px] bg-[#121A2F] border border-[#192440] rounded-2xl shadow-2xl p-8 hidden group-hover:flex gap-8 opacity-0 group-hover:opacity-100 transition-opacity z-50">
              <div className="w-1/3 border-r border-[#192440] pr-8">
                <h3 className="text-white font-bold text-xl mb-3">Drive larger-scale work</h3>
                <p className="text-slate-400 text-sm leading-relaxed">Build specialized teams for complex projects</p>
              </div>
              <div className="w-2/3 grid grid-cols-2 gap-y-8 gap-x-6">
                <a href="https://www.coursera.org/" target="_blank" rel="noopener noreferrer" className="block group/item">
                  <h4 className="text-white font-bold mb-1 group-hover/item:text-[#3B82F6] transition-colors">Build my website</h4>
                  <p className="text-slate-400 text-xs">Web design, development and more</p>
                </a>
                <a href="https://www.coursera.org/" target="_blank" rel="noopener noreferrer" className="block group/item">
                  <h4 className="text-white font-bold mb-1 group-hover/item:text-[#3B82F6] transition-colors">Design my brand</h4>
                  <p className="text-slate-400 text-xs">Logo, brand identity and more</p>
                </a>
                <a href="https://www.coursera.org/" target="_blank" rel="noopener noreferrer" className="block group/item">
                  <h4 className="text-white font-bold mb-1 group-hover/item:text-[#3B82F6] transition-colors">Scale my paid ad campaigns</h4>
                  <p className="text-slate-400 text-xs">Growth marketing, media strategy and more</p>
                </a>
                <a href="https://www.coursera.org/" target="_blank" rel="noopener noreferrer" className="block group/item">
                  <h4 className="text-white font-bold mb-1 group-hover/item:text-[#3B82F6] transition-colors">Automate my workflows</h4>
                  <p className="text-slate-400 text-xs">Planning, integration, AI agents and more</p>
                </a>
                <a href="https://www.coursera.org/" target="_blank" rel="noopener noreferrer" className="block group/item">
                  <h4 className="text-white font-bold mb-1 group-hover/item:text-[#3B82F6] transition-colors">Handle customer support with AI</h4>
                  <p className="text-slate-400 text-xs">Chatbots, AI agents, systems and more</p>
                </a>
                <a href="https://www.coursera.org/" target="_blank" rel="noopener noreferrer" className="block group/item">
                  <h4 className="text-white font-bold mb-1 group-hover/item:text-[#3B82F6] transition-colors">Build my sales pipeline</h4>
                  <p className="text-slate-400 text-xs">Lead generation, AI outreach and more</p>
                </a>
              </div>
            </div>
          </div>

          <button onClick={onExploreMarketplace} className="hover:text-white cursor-pointer transition-colors py-4">Marketplace</button>
          <a href="#why-skillbridge" className="hover:text-white cursor-pointer transition-colors py-4">Why SkillBridge</a>
          <a href="#specialists" className="hover:text-white cursor-pointer transition-colors py-4">Enterprise</a>
        </nav>
        <div className="flex gap-4">
          <button onClick={() => onLogin(activeTab)} className="hidden md:block text-slate-300 hover:text-white font-medium text-sm">Log in</button>
          <button onClick={() => onRegister(activeTab)} className="bg-[#3B82F6] hover:bg-[#60A5FA] text-white px-5 py-2 rounded-full font-medium transition-colors text-sm">
            Sign up
          </button>
        </div>
      </header>

      <main className="flex-1">
        <section className="max-w-[1400px] mx-auto px-8 py-16 md:py-24">
          <div className="bg-[#E0F2FE] rounded-full px-6 py-2 w-fit mb-12 text-[#0B1020] text-sm font-medium flex items-center gap-2 cursor-pointer hover:bg-[#BAE6FD] transition-colors">
            Discover the top 1% of personalized roadmaps. <span className="underline ml-2">Get started &gt;</span>
          </div>

          <div className={'relative rounded-3xl overflow-hidden border min-h-[500px] flex items-center p-8 md:p-12 lg:p-20 transition-colors duration-300 ' + (isFresherTrack ? 'bg-[#102324] border-emerald-400/30' : 'bg-[#121A2F] border-[#192440]')}>
            <div className={'absolute inset-0 bg-gradient-to-r z-10 ' + (isFresherTrack ? 'from-[#081715] via-[#081715]/90 to-transparent' : 'from-[#0B1020] via-[#0B1020]/90 to-transparent')}></div>
            <div className={'absolute inset-0 opacity-20 bg-cover bg-center ' + (isFresherTrack ? "bg-[url('https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=2000&q=80')]" : "bg-[url('https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=2000&q=80')]")}></div>
            
            <div className="relative z-20 max-w-2xl">
              <div className={'flex bg-[#192440]/60 backdrop-blur-md p-1 rounded-full w-fit mb-8 border ' + (isFresherTrack ? 'border-emerald-400/30' : 'border-[#3B82F6]/20')}>
                <button 
                  aria-pressed={activeTab === 'hire'} onClick={() => setActiveTab('hire')} 
                  className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${activeTab === 'hire' ? 'bg-[#3B82F6] text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  Experienced
                </button>
                <button 
                  aria-pressed={activeTab === 'work'} onClick={() => setActiveTab('work')} 
                  className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${activeTab === 'work' ? 'bg-emerald-400 text-[#071715]' : 'text-slate-400 hover:text-white'}`}
                >
                  Fresher
                </button>
              </div>

              <p className={'text-xs font-bold uppercase tracking-[0.2em] mb-4 ' + (isFresherTrack ? 'text-emerald-300' : 'text-[#93C5FD]')}>{isFresherTrack ? 'A launchpad for new talent' : 'Career growth for experienced professionals'}</p>
              <h1 className="text-5xl md:text-7xl font-bold mb-6 tracking-tight leading-[1.1]">{isFresherTrack ? <>Start your career <br/>with a clear plan</> : <>Make your next <br/>career move count</>}</h1>
              <p className="text-lg md:text-xl text-slate-300 mb-10 max-w-xl">{isFresherTrack ? 'Turn your coursework, projects, and strengths into a first-job plan. Find entry-level roles, see which skills to build, and get a practical roadmap to become job-ready.' : 'Build on the experience you already have. Compare your resume with relevant roles, identify the skills that could unlock your next step, and get a focused growth roadmap.'}</p>
              
              <div className="flex flex-wrap gap-3"><button onClick={() => onGetStarted(activeTab)} className={'px-8 py-4 rounded-full font-bold text-lg transition-all shadow-lg ' + (isFresherTrack ? 'bg-emerald-400 hover:bg-emerald-300 text-[#071715]' : 'bg-[#3B82F6] hover:bg-[#60A5FA] text-white')}>{isFresherTrack ? 'Build my first roadmap' : 'Build my career roadmap'}</button><button onClick={onExploreMarketplace} className="border border-white/30 hover:bg-white/10 text-white px-7 py-4 rounded-full font-bold text-lg transition-all">Explore marketplace</button></div>
            </div>
          </div>
        </section>

        <section id="roadmaps" className="bg-[#F8FAFC] py-24 text-[#0B1020]">
          <div className="max-w-[1400px] mx-auto px-8">
            <h2 className="text-4xl font-bold mb-12">Find roadmaps for every career</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {[
                { icon: Code, title: 'Development & IT' },
                { icon: PenTool, title: 'Design & Creative' },
                { icon: LineChart, title: 'Sales & Marketing' },
                { icon: FileText, title: 'Writing & Translation' },
                { icon: Users, title: 'Admin & Support' },
                { icon: BarChart3, title: 'Finance & Accounting' },
                { icon: Briefcase, title: 'HR & Training' },
                { icon: BrainCircuit, title: 'AI Services' }
              ].map((cat, i) => (
                <button type="button" key={i} onClick={() => { setSelectedRoadmapCategory(cat.title); setSelectedRoadmapSkills([]); }} className={'text-left bg-white p-8 rounded-2xl shadow-sm border hover:shadow-md transition-shadow cursor-pointer flex flex-col gap-4 ' + (selectedRoadmapCategory === cat.title ? 'border-emerald-500 ring-2 ring-emerald-100' : 'border-slate-200')}>
                  <cat.icon size={32} className="text-[#3B82F6]" />
                  <h3 className="font-semibold text-lg">{cat.title}</h3>
                </button>
              ))}
            </div>
            {selectedRoadmapCategory && <div className="mt-16 rounded-[2rem] p-8 md:p-12 text-white shadow-xl bg-gradient-to-br from-[#172554] via-[#3730A3] to-[#0F172A] border border-indigo-300/20">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-8"><div><p className="text-sm font-bold uppercase tracking-wide text-white/80">Build a focused learning plan</p><h3 className="text-3xl md:text-4xl font-semibold mt-2">Find mentors by {selectedRoadmapCategory} skills</h3><p className="text-white/85 mt-2">Choose what you want to learn, or add your own skills.</p></div><button type="button" onClick={() => { localStorage.setItem('skillbridge_selected_career', selectedRoadmapCategory); localStorage.setItem('skillbridge_selected_career_skills', JSON.stringify(selectedRoadmapSkills)); onGetStarted('work'); }} className="bg-cyan-200 text-slate-950 px-8 py-4 rounded-xl font-semibold hover:bg-cyan-100">Continue</button></div>
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">{(roadmapSkillCatalog[selectedRoadmapCategory] || []).map(skill => { const active=selectedRoadmapSkills.includes(skill); return <button key={skill} type="button" aria-pressed={active} onClick={() => setSelectedRoadmapSkills(current => active ? current.filter(x=>x!==skill) : [...current,skill])} className={'rounded-lg px-4 py-3 text-left text-sm flex items-center justify-between gap-2 '+(active?'bg-indigo-200 text-indigo-950':'bg-white/10 border border-white/15 hover:bg-white/20 text-white')}><span className="truncate">{skill}</span><span className="text-xl">{active?'✓':'+'}</span></button>;})}{selectedRoadmapSkills.filter(skill=>!(roadmapSkillCatalog[selectedRoadmapCategory]||[]).includes(skill)).map(skill=><button key={skill} type="button" onClick={()=>setSelectedRoadmapSkills(current=>current.filter(x=>x!==skill))} className="rounded-lg px-4 py-3 text-left text-sm bg-white text-emerald-900 flex items-center justify-between">{skill}<span>✓</span></button>)}</div>
              <form onSubmit={event=>{event.preventDefault();const skill=customRoadmapSkill.trim();if(skill&&!selectedRoadmapSkills.includes(skill))setSelectedRoadmapSkills(current=>[...current,skill]);setCustomRoadmapSkill('');}} className="mt-5 flex flex-col sm:flex-row gap-3"><input value={customRoadmapSkill} onChange={event=>setCustomRoadmapSkill(event.target.value)} placeholder="Add a custom skill" className="flex-1 rounded-xl px-4 py-3 text-slate-900 placeholder-slate-500 focus:outline-none"/><button className="rounded-xl border border-white/80 px-6 py-3 font-semibold hover:bg-white/10">Add skill</button></form>
              <div className="mt-10 border-t border-white/30 pt-8"><div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-5"><div><p className="text-sm font-bold uppercase tracking-wide text-white/80">Mentors in this career area</p><h4 className="text-2xl font-semibold mt-1">{selectedRoadmapSkills.length ? 'Matches for your selected skills' : 'All mentors in ' + selectedRoadmapCategory}</h4><p className="text-sm text-white/80 mt-2">{selectedRoadmapSkills.length ? 'Showing mentors with at least one matching skill.' : 'Choose specific skills above to narrow these recommendations.'}</p></div><span className="rounded-full bg-white/20 px-4 py-2 text-sm font-semibold">{visibleRoadmapMentors.length} {visibleRoadmapMentors.length===1?'mentor':'mentors'}</span></div>
                {visibleRoadmapMentors.length ? <div className="grid lg:grid-cols-2 gap-4">{visibleRoadmapMentors.map(mentor=><article key={mentor.name} className="rounded-2xl border border-indigo-200/20 bg-[#101A33]/95 p-5 text-white shadow-lg shadow-indigo-950/20"><div className="flex items-start gap-4"><img src={mentor.img} alt={mentor.name} className="w-16 h-16 rounded-xl object-cover shrink-0"/><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><div><h5 className="font-bold text-lg">{mentor.name}</h5><p className="text-sm text-slate-300">{mentor.role}</p></div><span className="text-sm font-semibold text-sky-300">★ {mentor.rating.toFixed(1)} <span className="text-slate-400 font-normal">({mentor.reviewCount})</span></span></div><p className="text-xs text-slate-400 mt-2">{mentor.domain} · {mentor.exp} experience · {mentor.teachTime} learning plan</p><p className="text-sm font-semibold text-cyan-300 mt-1">{mentor.rate}</p></div></div><div className="flex flex-wrap gap-2 mt-4">{mentor.skills.map(skill=><span key={skill} className={'rounded-full px-3 py-1 text-xs '+(selectedRoadmapSkills.some(selected=>skill.toLowerCase().includes(selected.toLowerCase())||selected.toLowerCase().includes(skill.toLowerCase()))?'bg-indigo-300/20 text-sky-200 font-semibold border border-indigo-200/20':'bg-[#0B1020] text-slate-300 border border-[#263554]')}>{skill}</span>)}</div><blockquote className="mt-4 border-l-2 border-cyan-400 pl-3 text-sm leading-relaxed text-slate-300">“{mentor.review}”</blockquote><p className="mt-2 text-[11px] uppercase tracking-wide text-slate-400">Sample learner review</p><button type="button" onClick={()=>setComparedMentors(current=>current.some(item=>item.name===mentor.name)?current.filter(item=>item.name!==mentor.name):current.length<2?[...current,mentor]:current)} disabled={comparedMentors.length>=2&&!comparedMentors.some(item=>item.name===mentor.name)} className="mt-4 w-full rounded-xl border border-indigo-300/40 px-4 py-2.5 text-sm font-semibold text-indigo-100 hover:bg-indigo-300/10 disabled:opacity-40">{comparedMentors.some(item=>item.name===mentor.name)?'Added to compare −':'Compare mentor +'}</button></article>)}</div> : <div className="rounded-xl border border-white/50 bg-white/15 p-5 text-sm text-white">No mentors in this department currently list those exact skills. Remove a selected skill to see more mentors.</div>}
              </div>
              {comparedMentors.length>0&&<section className="mt-8 rounded-2xl border border-indigo-200/20 bg-[#0B1020]/70 p-5"><div className="flex items-center justify-between gap-3 mb-4"><div><p className="text-xs uppercase tracking-widest text-cyan-300 font-bold">Mentor comparison</p><p className="text-sm text-slate-300 mt-1">Compare up to two mentors side by side.</p></div><button type="button" onClick={()=>setComparedMentors([])} className="text-xs text-slate-400 hover:text-white underline">Clear</button></div><div className="grid md:grid-cols-2 gap-3">{comparedMentors.map(mentor=><article key={mentor.name} className="rounded-xl border border-[#263554] bg-[#121A2F] p-4"><div className="flex items-center gap-3"><img src={mentor.img} alt={mentor.name} className="w-12 h-12 rounded-lg object-cover"/><div><h5 className="font-bold text-white">{mentor.name}</h5><p className="text-xs text-sky-300">★ {mentor.rating.toFixed(1)} · {mentor.reviewCount} reviews</p></div><button type="button" onClick={()=>setComparedMentors(current=>current.filter(item=>item.name!==mentor.name))} className="ml-auto text-slate-500 hover:text-white" aria-label={'Remove '+mentor.name+' from comparison'}>×</button></div><p className="text-sm text-slate-300 mt-3">{mentor.role}</p><p className="text-xs text-slate-400 mt-1">{mentor.exp} experience · {mentor.rate}</p><div className="flex flex-wrap gap-1.5 mt-3">{mentor.skills.map(skill=><span key={skill} className="text-[11px] rounded-full bg-indigo-300/10 text-indigo-100 px-2.5 py-1">{skill}</span>)}</div><p className="text-sm text-slate-400 mt-3">“{mentor.review}”</p></article>)}</div></section>}
            </div>}
          </div>
        </section>

        <section id="plans" className="bg-[#0B1020] py-24 text-white border-y border-[#192440]">
          <div className="max-w-6xl mx-auto px-8"><div className="text-center mb-12"><p className="text-sm font-bold uppercase tracking-widest text-cyan-300">SkillBridge plans</p><h2 className="text-4xl font-bold mt-3">Choose how you want to grow</h2><p className="text-slate-400 mt-3">Both options are free in this preview. No payment is collected.</p></div>
            <div className="grid md:grid-cols-2 gap-8">{[{name:'Basic',subtitle:'For occasional learning and one-off projects',copy:'Build a profile, explore mentors, and start a practical career plan.',items:['Career roadmap and skill gap review','Mentor profiles, ratings, and learner reviews','Marketplace access across key skill areas','Save progress in your browser'],popular:false},{name:'Business Plus',subtitle:'For ongoing growth and teams',copy:'Get a more guided experience with curated recommendations and team-ready planning.',items:['Everything in Basic','Curated mentor shortlists by skill gap','Highly rated specialists and review highlights','Shared planning and priority learning paths'],popular:true}].map(plan=><article key={plan.name} className={'relative bg-[#121A2F] text-white rounded-3xl border p-8 md:p-10 shadow-xl flex flex-col '+(plan.popular?'border-indigo-400 shadow-indigo-950/40':'border-[#263554]')}>{plan.popular&&<span className="absolute right-0 top-0 rounded-bl-2xl rounded-tr-3xl bg-indigo-300 px-5 py-2 text-xs font-bold uppercase text-indigo-950">Popular</span>}<h3 className="text-2xl font-semibold">{plan.name}</h3><p className="text-slate-400 text-sm mt-1">{plan.subtitle}</p><p className="text-slate-300 mt-6">{plan.copy}</p><div className="border-t border-[#263554] my-6"/><h4 className="font-semibold text-slate-200">{plan.popular?'Everything in Basic, plus:':'Basic includes:'}</h4><ul className="space-y-4 mt-5 flex-1">{plan.items.map(item=><li key={item} className="flex gap-3 text-slate-300"><CheckCircle size={20} className="shrink-0 text-cyan-300"/>{item}</li>)}</ul><button onClick={()=>onGetStarted('work')} className={'mt-8 w-full rounded-xl py-3 font-semibold '+(plan.popular?'bg-indigo-500 hover:bg-indigo-400 text-white':'border-2 border-indigo-300 text-indigo-100 hover:bg-indigo-300/10')}>Get started for free</button></article>)}</div>
          </div>
        </section>

        <section id="outcomes" className="max-w-[1400px] mx-auto px-8 py-24">
          <h2 className="text-4xl font-bold mb-12">Proven results on SkillBridge</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { text: "We discovered CTO-level expertise on the platform—someone who had already served as a startup CTO—willing to contribute to our open-source project.", author: "Saswata Basu, CEO", company: "Züs" },
              { text: "SkillBridge isn't just a learning platform for us—it's a strategic partner. It's helped us fill every technical gap, accelerate our delivery from months to weeks.", author: "David Wrench, Co-Founder", company: "Datajoi" },
              { text: "I found an awesome career path and wound up getting hired as an AI developer based in Paris...I couldn't be this far along without the roadmaps.", author: "Matt See, Co-Founder", company: "Lighthouse" }
            ].map((test, i) => (
              <div key={i} className="bg-[#121A2F] border border-[#192440] p-8 rounded-2xl flex flex-col justify-between">
                <p className="text-slate-300 text-lg leading-relaxed mb-8">"{test.text}"</p>
                <div>
                  <p className="font-bold text-white">{test.author}</p>
                  <p className="text-slate-500 text-sm">{test.company}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="why-skillbridge" className="bg-[#121A2F] border-y border-[#192440] py-24">
          <div className="max-w-[1400px] mx-auto px-8 flex flex-col md:flex-row items-center gap-16">
            <div className="flex-1">
              <h2 className="text-4xl font-bold mb-6">Get insights into career salaries</h2>
              <p className="text-slate-400 text-lg mb-8">We'll analyze the average market rates for the skills you're building.</p>
              <div className="bg-white rounded-full p-2 flex items-center max-w-md focus-within:ring-2 ring-[#3B82F6]">
                <input type="text" placeholder="e.g. React Developer in New York" className="flex-1 px-4 outline-none text-[#0B1020]" />
                <button className="bg-[#0B1020] text-white p-2 rounded-full hover:bg-black"><ChevronRight/></button>
              </div>
            </div>
            <div className="flex-1 w-full relative">
              <div className="bg-[#0B1020] border border-[#192440] p-8 rounded-3xl relative overflow-hidden shadow-2xl h-[300px] flex flex-col justify-center items-center">
                 <div className="absolute inset-0 bg-gradient-to-t from-[#3B82F6]/10 to-transparent opacity-50"></div>
                 <h3 className="text-xl font-medium mb-12 z-10">Salary estimate</h3>
                 
                 <div className="relative w-full max-w-[300px] h-20 flex items-end justify-center z-10">
                   <svg viewBox="0 0 100 50" className="absolute inset-0 w-full h-full overflow-visible" preserveAspectRatio="none">
                     <path d="M 0 50 C 20 50, 30 10, 50 10 C 70 10, 80 50, 100 50" fill="none" stroke="#60A5FA" strokeWidth="2" strokeDasharray="4 4"/>
                     <path d="M 25 50 C 30 20, 40 10, 50 10 C 60 10, 70 20, 75 50" fill="none" stroke="#3B82F6" strokeWidth="3"/>
                   </svg>
                   <div className="absolute left-[20%] top-[-20px] bg-[#121A2F] border border-[#3B82F6] px-3 py-1 rounded-full text-sm font-bold text-white">$80k</div>
                   <div className="absolute right-[20%] top-[-20px] bg-[#121A2F] border border-[#3B82F6] px-3 py-1 rounded-full text-sm font-bold text-white">$150k</div>
                   <div className="text-slate-400 text-sm mt-4">Typical</div>
                 </div>
              </div>
              <div className="absolute -inset-10 bg-[#3B82F6] opacity-10 blur-3xl rounded-full z-0 pointer-events-none"></div>
            </div>
          </div>
        </section>
        
        <SpecialistsSection />
      </main>

      <footer className="bg-[#0B1020] pt-20 pb-10 border-t border-[#121A2F]">
        <div className="max-w-[1400px] mx-auto px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-16 text-sm">
            <div>
              <h4 className="font-bold text-white mb-6">For Candidates</h4>
              <ul className="space-y-4 text-slate-400">
                <li><a href="#" className="hover:text-white">How to learn</a></li>
                <li><a href="#" className="hover:text-white">Roadmap Catalog</a></li>
                <li><a href="#" className="hover:text-white">Resume Analysis</a></li>
                <li><a href="#plans" className="hover:text-white">Business Plus</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-white mb-6">For Talent</h4>
              <ul className="space-y-4 text-slate-400">
                <li><a href="#" className="hover:text-white">How to find work</a></li>
                <li><a href="#" className="hover:text-white">Direct Contracts</a></li>
                <li><a href="#" className="hover:text-white">Find jobs worldwide</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-white mb-6">Resources</h4>
              <ul className="space-y-4 text-slate-400">
                <li><a href="#" className="hover:text-white">Help & support</a></li>
                <li><a href="#" className="hover:text-white">Success stories</a></li>
                <li><a href="#" className="hover:text-white">Blog</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-white mb-6">Company</h4>
              <ul className="space-y-4 text-slate-400">
                <li><a href="#" className="hover:text-white">About us</a></li>
                <li><a href="#" className="hover:text-white">Leadership</a></li>
                <li><a href="#" className="hover:text-white">Careers</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-[#192440] pt-8 flex flex-col md:flex-row justify-between items-center text-slate-500 text-xs">
            <p>© 2026 SkillBridge® Global LLC</p>
            <div className="flex gap-4 mt-4 md:mt-0">
              <a href="#" className="hover:text-white">Terms of Service</a>
              <a href="#" className="hover:text-white">Privacy Policy</a>
              <a href="#" className="hover:text-white">Accessibility</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Sidebar({ currentView, onNavigate, onLogout }) {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'profile', label: 'My Profile', icon: Users },
    { id: 'market', label: 'Job Market', icon: Search },
    { id: 'marketplace', label: 'Marketplace', icon: Briefcase },
  ];

  return (
    <aside className="w-64 bg-[#0B1020] border-r border-[#192440] flex flex-col hidden md:flex z-20 relative">
      <div className="p-8 pb-10">
        <div className="text-2xl font-bold tracking-tight flex items-center gap-2 cursor-pointer" onClick={() => onNavigate('landing')}>
          <BrainCircuit className="text-[#3B82F6]" />
          SkillBridge
        </div>
      </div>
      <nav className="flex-1 px-4 space-y-2">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all ${
              currentView === item.id || (item.id === 'market' && currentView.startsWith('analysis-'))
                ? 'bg-[#121A2F] text-[#3B82F6] border border-[#192440]' 
                : 'text-slate-400 hover:bg-[#121A2F] hover:text-white'
            }`}
          >
            <item.icon size={20} className={currentView === item.id || (item.id === 'market' && currentView.startsWith('analysis-')) ? "text-[#3B82F6]" : ""} />
            {item.label}
          </button>
        ))}
      </nav>
      <div className="p-4 border-t border-[#192440]">
        <button onClick={onLogout} className="w-full flex items-center gap-3 px-4 py-3 text-slate-400 hover:text-white transition-colors rounded-xl hover:bg-[#121A2F]">
          <LogOut size={20} />
          Sign Out
        </button>
      </div>
    </aside>
  );
}

function Dashboard({ user, userData, onNavigate }) {
  const jobs = Array.isArray(userData.foundJobs) ? userData.foundJobs : [];
  const savedSkills = Array.isArray(userData.skills) ? userData.skills : [];
  const analyses = userData.analyses || {};
  const completedAnalyses = Object.keys(analyses).length;
  const profileFields = [userData.name, userData.headline, userData.location, userData.overview, userData.education, userData.experienceSummary, userData.targetJob, userData.resumeText];
  const skillProgress = Math.min(savedSkills.length / 8, 1);
  const profileProgress = Math.round((profileFields.filter(value => Boolean(value && String(value).trim())).length + skillProgress) / (profileFields.length + 1) * 100);
  const normalizeSkill = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const comparisons = jobs.map(job => { const required = [...new Set([...(job.matched_skills || []), ...(job.missing_skills || [])].filter(Boolean))]; const covered = required.filter(need => savedSkills.some(skill => { const a=normalizeSkill(skill), b=normalizeSkill(need); return a && b && (a===b || a.includes(b) || b.includes(a)); })); return {required,covered}; }).filter(item => item.required.length);
  const exampleRequirements = Array.isArray(userData.exampleRequirements) ? userData.exampleRequirements : [];
  const exampleComparisons = !jobs.length && !comparisons.length && exampleRequirements.length ? [{ required: exampleRequirements, covered: exampleRequirements.filter(need => savedSkills.some(skill => { const a=normalizeSkill(skill), b=normalizeSkill(need); return a && b && (a===b || a.includes(b) || b.includes(a)); })) }] : [];
  const skillComparisons = comparisons.length ? comparisons : exampleComparisons;
  const isExampleSkillMatch = !comparisons.length && exampleComparisons.length > 0;
  const jobSkillMatch = skillComparisons.length ? Math.round(skillComparisons.reduce((total,item)=>total+item.covered.length/item.required.length,0)/skillComparisons.length*100) : null;
  const missingEmployerSkills = [...new Set(skillComparisons.flatMap(item=>item.required.filter(need=>!savedSkills.some(skill=>{const a=normalizeSkill(skill),b=normalizeSkill(need);return a&&b&&(a===b||a.includes(b)||b.includes(a));}))))].slice(0,6);
  const dashboardProgress = jobSkillMatch === null ? profileProgress : jobSkillMatch;
  const firstName = userData.name?.trim().split(/\s+/)[0];
  const nextStep = jobSkillMatch !== null && jobSkillMatch < 80 ? 'Build the skills employers are asking for' : profileProgress < 100 ? 'Finish your profile' : jobs.length === 0 ? 'Find roles that fit your goals' : completedAnalyses === 0 ? 'Compare your skills with a role' : 'Keep building your career momentum';

  return (
    <div className="max-w-6xl mx-auto animate-in fade-in duration-500 pb-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-[0.22em] text-[#60A5FA]">Your career workspace</p><h1 className="text-4xl font-bold mt-2 text-white">{firstName ? `Welcome back, ${firstName}` : 'Your next move starts here'}</h1><p className="text-slate-400 mt-2">{userData.targetJob ? <>A clearer path toward <span className="text-[#93C5FD] font-medium">{userData.targetJob}</span></> : 'Build your profile, explore roles, and turn your goals into a plan.'}</p></div>
        <button onClick={() => onNavigate(profileProgress ? 'profile' : 'profile')} className="bg-[#3B82F6] hover:bg-[#60A5FA] text-white px-5 py-3 rounded-xl font-semibold transition-colors flex items-center gap-2"><FileText size={17}/> {profileProgress ? 'Edit profile' : 'Build your profile'}</button>
      </header>

      <section className="relative overflow-hidden rounded-3xl border border-[#263554] bg-gradient-to-br from-[#172846] via-[#121A2F] to-[#10233A] p-6 md:p-8 mb-6">
        <div className="absolute -right-12 -top-16 w-64 h-64 rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />
        <div className="relative grid md:grid-cols-[1fr_auto] gap-8 items-center">
          <div><div className="flex items-center gap-2 text-[#93C5FD] text-xs font-bold tracking-[0.18em] uppercase"><Zap size={15}/> Career momentum</div><h2 className="text-2xl font-bold text-white mt-3">{nextStep}</h2><p className="text-slate-400 mt-2 max-w-xl">Your progress updates as you add your own details and explore opportunities. Nothing is prefilled.</p>
            <div className="flex flex-wrap gap-3 mt-6"><button onClick={() => onNavigate(profileProgress < 100 ? 'profile' : 'market')} className="rounded-xl bg-white text-slate-950 px-5 py-3 font-semibold hover:bg-blue-100 transition-colors">{profileProgress < 100 ? 'Continue profile' : 'Explore opportunities'} <ChevronRight className="inline ml-1" size={16}/></button><span className="inline-flex items-center gap-2 text-sm text-slate-400 px-2"><Activity size={16} className="text-cyan-300"/> A little progress adds up</span></div>
          </div>
          <div className="flex items-center gap-5 justify-center md:pr-5"><div className="relative w-32 h-32 rounded-full flex items-center justify-center career-progress-ring" style={{'--progress': `${dashboardProgress}%`, '--progress-color': dashboardProgress>=80?'#34d399':dashboardProgress>=55?'#fbbf24':'#fb7185'}}><div className="w-[104px] h-[104px] rounded-full bg-[#101A2D] flex flex-col items-center justify-center"><span className="text-3xl font-black text-white tabular-nums">{dashboardProgress}%</span><span className="text-[10px] text-slate-400 uppercase tracking-wider">{jobSkillMatch===null?'profile':'job match'}</span></div></div></div>
        </div>
        <div className="relative mt-7 grid grid-cols-3 gap-2 md:gap-3">
          {[['Basics',Boolean(userData.name && userData.location)],['Career goal',Boolean(userData.targetJob)],['Skills match',jobSkillMatch !== null && jobSkillMatch >= 80]].map(([label,done],index)=><div key={label} className="rounded-xl bg-[#0B1020]/55 border border-white/5 p-3"><div className="flex items-center gap-2 text-sm text-slate-300"><span className={`w-5 h-5 rounded-full flex items-center justify-center ${done?'bg-emerald-400/15 text-emerald-300':'bg-slate-700/60 text-slate-500'}`}>{done?<CheckCircle size={14}/>:<span className="text-[10px]">{index+1}</span>}</span>{label==='Skills match'?`Skills match · ${jobSkillMatch===null?'—':jobSkillMatch+'%'}`:label}</div><div className="mt-3 h-1.5 rounded-full bg-slate-700/60 overflow-hidden"><div className={`h-full rounded-full transition-all duration-700 ${label==='Skills match'&&jobSkillMatch!==null?(jobSkillMatch>=80?'bg-emerald-400':jobSkillMatch>=55?'bg-amber-400':'bg-rose-400'):done?'bg-emerald-400':'bg-blue-400/70'}`} style={{width:label==='Skills match'?(jobSkillMatch===null?'0%':jobSkillMatch+'%'):(done?'100%':'25%')}} /></div></div>)} 
        </div>
      </section>

      <section className="bg-[#121A2F] border border-[#192440] rounded-3xl p-6 mb-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-[0.18em] font-bold text-slate-500">{isExampleSkillMatch ? 'Sample skill comparison' : 'Employer skill comparison'}</p><h2 className="text-xl font-bold text-white mt-2">{jobSkillMatch === null ? 'Compare your skills with job requirements' : isExampleSkillMatch ? 'Example skill match for this career goal' : 'Current skill match across your saved job listings'}</h2><p className="text-sm text-slate-400 mt-2">{jobSkillMatch === null ? 'Load and save an example profile to preview a skill comparison, or search for real job listings.' : isExampleSkillMatch ? 'This preview uses fictional example requirements for your sample role. Find and match jobs to compare against live listings.' : 'This score is recalculated from listed job requirements and the skills in your saved profile.'}</p></div>{jobSkillMatch === null ? <button onClick={()=>onNavigate('profile')} className="rounded-xl border border-cyan-300/30 px-4 py-2 text-sm text-cyan-200 hover:bg-cyan-300/10">Match jobs</button> : <div className={'text-3xl font-black '+(jobSkillMatch>=80?'text-emerald-300':jobSkillMatch>=55?'text-amber-300':'text-rose-300')}>{jobSkillMatch}%</div>}</div>{jobSkillMatch!==null&&<div className="mt-5"><div className="h-2 rounded-full bg-slate-700 overflow-hidden"><div className={'h-full rounded-full transition-all duration-700 '+(jobSkillMatch>=80?'bg-emerald-400':jobSkillMatch>=55?'bg-amber-400':'bg-rose-400')} style={{width:jobSkillMatch+'%'}}/></div>{isExampleSkillMatch&&<p className="text-xs text-slate-500 mt-4">Fictional example requirements · not a live employer listing</p>}{missingEmployerSkills.length>0?<><p className="text-xs uppercase tracking-wider text-slate-500 mt-5">{isExampleSkillMatch?'Skills to consider adding':'Skills listed in jobs that aren’t in your profile'}</p><div className="flex flex-wrap gap-2 mt-2">{missingEmployerSkills.map(skill=><span key={skill} className="rounded-full border border-amber-400/20 bg-amber-400/5 px-3 py-1 text-xs text-amber-200">{skill}</span>)}</div></>:<p className="text-sm text-emerald-300 mt-4">Your saved skills cover the requirements found in these listings.</p>}</div>}</section>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[[jobs.length,'Matched roles',Briefcase,'market'],[completedAnalyses,'Skill reviews',BarChart3,'market'],[savedSkills.length,'Your skills',Zap,'profile'],[userData.isFresher === null || userData.isFresher === undefined ? '—' : userData.isFresher ? 'Early career' : 'Experienced','Career stage',Activity,'profile']].map(([value,label,Icon,view])=><button key={label} onClick={()=>onNavigate(view)} className="text-left bg-[#121A2F] hover:bg-[#17233A] transition-colors p-5 rounded-2xl border border-[#192440]"><span className="w-9 h-9 rounded-xl bg-[#3B82F6]/10 text-[#60A5FA] flex items-center justify-center"><Icon size={17}/></span><span className="block text-2xl font-bold text-white mt-4">{value}</span><span className="block text-xs text-slate-500 mt-1">{label}</span></button>)}
      </div>

      <section className="bg-[#121A2F] p-6 rounded-3xl border border-[#192440] mb-6">
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-[0.18em] font-bold text-slate-500">Saved profile</p><h2 className="text-2xl font-bold text-white mt-2">{userData.name || 'Your profile is ready to build'}</h2><p className="text-[#93C5FD] mt-1">{userData.headline || 'Add a headline to introduce yourself'}</p></div><button onClick={()=>onNavigate('profile')} className="shrink-0 rounded-xl border border-[#334155] px-4 py-2 text-sm text-slate-200 hover:border-blue-400 hover:text-white">Edit profile</button></div>
        <div className="mt-5 grid md:grid-cols-3 gap-4 text-sm"><div><p className="text-slate-500 text-xs uppercase tracking-wider">Location</p><p className="text-slate-200 mt-1">{userData.location || 'Not added yet'}</p></div><div><p className="text-slate-500 text-xs uppercase tracking-wider">Target role</p><p className="text-slate-200 mt-1">{userData.targetJob || 'Not added yet'}</p></div><div><p className="text-slate-500 text-xs uppercase tracking-wider">Career stage</p><p className="text-slate-200 mt-1">{userData.isFresher == null ? 'Not selected' : userData.isFresher ? 'Fresher / early career' : 'Experienced'}</p></div></div>
        {userData.overview&&<p className="mt-4 text-sm text-slate-400 leading-relaxed">{userData.overview}</p>}{userData.additionalInfo&&<p className="mt-3 text-sm text-slate-400 leading-relaxed">{userData.additionalInfo}</p>}
        <div className="mt-5"><p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Key skills · {savedSkills.length}</p>{savedSkills.length>0?<div aria-live="polite" className="flex flex-wrap gap-2 mt-3">{savedSkills.map((skill,index)=><span key={skill+'-'+index} className="rounded-full bg-[#0B1020] border border-[#263554] px-3 py-1 text-xs text-slate-200">{skill}</span>)}</div>:<p className="text-sm text-slate-500 mt-2">No skills saved. Add skills in My Profile, then select Save Profile.</p>}</div>
      </section>

      <div className="grid lg:grid-cols-[1.15fr_.85fr] gap-6">
        <section className="bg-[#121A2F] p-6 rounded-3xl border border-[#192440]"><div className="flex items-center justify-between gap-4"><div><p className="text-xs uppercase tracking-[0.18em] font-bold text-slate-500">Opportunity radar</p><h2 className="text-xl font-bold text-white mt-2">{jobs.length ? `${jobs.length} roles on your radar` : 'Your opportunities will appear here'}</h2></div><div className="w-11 h-11 rounded-full bg-cyan-300/10 text-cyan-300 flex items-center justify-center"><Briefcase size={20}/></div></div><p className="text-sm text-slate-400 mt-3">{jobs.length ? 'Open your matched roles to review requirements and plan your next step.' : 'Once your profile is ready, search for current openings matched to your skills and career stage.'}</p><button onClick={()=>onNavigate(jobs.length?'market':'profile')} className="mt-5 text-sm font-semibold text-[#93C5FD] hover:text-white">{jobs.length?'View matched roles':'Prepare my profile'} <ChevronRight className="inline" size={16}/></button></section>
        <section className="bg-[#121A2F] p-6 rounded-3xl border border-[#192440] min-h-48"><h2 className="text-xs font-bold text-slate-500 uppercase tracking-[0.18em] mb-4 flex items-center gap-2"><Newspaper size={15}/> Career signals</h2><NewsWidget targetJob={userData.targetJob}/></section>
      </div>
    </div>
  );
}

const exampleProfiles = [
  {name:'Jordan Lee',location:'Toronto, Canada',headline:'Junior Product Designer focused on accessible digital experiences',overview:'Early-career designer building clear, inclusive interfaces. Interested in product teams where research and thoughtful interaction design shape useful tools.',skills:'Figma, UX research, wireframing, prototyping, accessibility, design systems',education:'Diploma in Interaction Design, 2025',experienceSummary:'Completed a design internship supporting usability reviews and responsive product flows. Created a volunteer event-finder prototype and tested it with community members.',preferredWorkType:'Full-time',resumeText:'Jordan Lee\nJunior Product Designer\n\nSkills: Figma, UX research, wireframing, prototyping, accessibility, design systems.\n\nExperience: Product Design Intern, Northstar Studio (4 months): Supported usability reviews, created responsive flows, and prepared clickable prototypes for a community event finder.\n\nEducation: Diploma in Interaction Design, 2025.',targetJob:'Product Designer',isFresher:true,exampleRequirements:['Figma','UX research','prototyping','accessibility','design systems','user testing'],additionalInfo:'Portfolio: jordanlee.example. Interested in accessibility, early-stage products, and collaborative teams.'},
  {name:'Alex Morgan',location:'Austin, United States',headline:'Senior Frontend Engineer | React, TypeScript, and design systems',overview:'Experienced frontend engineer who builds accessible, maintainable product interfaces and helps teams improve delivery practices.',skills:'React, TypeScript, JavaScript, accessibility, design systems, performance, mentoring',education:'B.S. Software Engineering, 2018',experienceSummary:'Seven years building web products. Led a design-system rollout, improved page performance, and mentored a team of four engineers.',preferredWorkType:'Full-time',resumeText:'Alex Morgan\nSenior Frontend Engineer\n\nSkills: React, TypeScript, JavaScript, accessibility, design systems, web performance.\n\nExperience: Frontend Engineer (7 years): Led a shared component library, improved application loading performance, reviewed technical designs, and mentored four engineers.\n\nEducation: B.S. Software Engineering, 2018.',targetJob:'Frontend Engineer',isFresher:false,exampleRequirements:['React','TypeScript','JavaScript','accessibility','design systems','web performance'],additionalInfo:'Portfolio: alexmorgan.example. Interested in staff-level growth and accessible product development.'},
  {name:'Priya Kapoor',location:'Mumbai, India',headline:'Digital Marketing Specialist | Content, SEO, and campaign analytics',overview:'Marketing professional who combines thoughtful storytelling with measurable campaign improvements across web and email.',skills:'SEO, content strategy, email marketing, Google Analytics, copywriting, campaign reporting',education:'B.A. Communications, 2021',experienceSummary:'Four years planning content calendars and lifecycle campaigns for consumer brands. Increased organic visits through content refreshes and search improvements.',preferredWorkType:'Any',resumeText:'Priya Kapoor\nDigital Marketing Specialist\n\nSkills: SEO, content strategy, email marketing, analytics, copywriting.\n\nExperience: Digital Marketing Specialist (4 years): Planned editorial calendars, improved landing-page copy, supported lifecycle campaigns, and reported campaign performance to stakeholders.\n\nEducation: B.A. Communications, 2021.',targetJob:'Digital Marketing Manager',isFresher:false,exampleRequirements:['SEO','content strategy','email marketing','analytics','copywriting','campaign reporting'],additionalInfo:'Portfolio: priyakapoor.example. Interested in mission-led brands and growth strategy.'},
  {name:'Sam Okafor',location:'Lagos, Nigeria',headline:'Entry-Level Data Analyst | SQL, spreadsheets, and clear reporting',overview:'Recent graduate who enjoys turning messy information into practical answers for teams and customers.',skills:'SQL, Excel, Python, data cleaning, dashboards, communication',education:'B.Sc. Statistics, 2025',experienceSummary:'Completed a university research project analyzing public transport patterns and volunteered to prepare monthly reports for a local nonprofit.',preferredWorkType:'Full-time',resumeText:'Sam Okafor\nEntry-Level Data Analyst\n\nSkills: SQL, Excel, Python, data cleaning, dashboards, communication.\n\nProjects: Analyzed public transport data for a university project, cleaned survey responses, and presented findings with clear charts. Prepared monthly volunteer reports for a local nonprofit.\n\nEducation: B.Sc. Statistics, 2025.',targetJob:'Data Analyst',isFresher:true,exampleRequirements:['SQL','Excel','Python','data cleaning','dashboards','data visualization'],additionalInfo:'Portfolio: samokafor.example. Interested in public-interest data and entry-level analyst roles.'}
];

function ProfileEditor({ user, userData, onSaved, onComplete }) {
  const [form,setForm]=useState(()=>({name:userData.name||'',location:userData.location||'',headline:userData.headline||'',overview:userData.overview||'',skills:(userData.skills||[]).join(', '),education:userData.education||'',experienceSummary:userData.experienceSummary||'',preferredWorkType:userData.preferredWorkType||'Any',resumeText:userData.resumeText||'',targetJob:userData.targetJob||'',isFresher:userData.isFresher??true,additionalInfo:userData.additionalInfo||'',exampleRequirements:Array.isArray(userData.exampleRequirements)?userData.exampleRequirements:[]}));
  const [saving,setSaving]=useState(false),[matching,setMatching]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[matchNotice,setMatchNotice]=useState('');
  const [showRoleSuggestions,setShowRoleSuggestions]=useState(false);
  const [exampleIndex,setExampleIndex]=useState(0);
  const roleSuggestions=['React Developer','Frontend Engineer','Full Stack Developer','Backend Engineer','Data Scientist','UI/UX Designer','Product Manager','DevOps Engineer','Machine Learning Engineer','Software Engineer'];
  const matchingRoles=roleSuggestions.filter(role=>role.toLowerCase().includes(form.targetJob.toLowerCase())&&role.toLowerCase()!==form.targetJob.toLowerCase());
  const update=(key,value)=>{setForm(previous=>({...previous,[key]:value}));setSaved(false);setMatchNotice('');};
  const selectRole=async role=>{update('targetJob',role);setShowRoleSuggestions(false);setError('');setMatchNotice('Saving your career goal…');try{await saveUserProfile(user.uid,{targetJob:role});onSaved({targetJob:role});setMatchNotice('Career goal saved. Your dashboard is updated.');}catch(err){setMatchNotice('');setError(err.message||'Could not save your career goal. Save your profile to try again.');}};
  const loadExample=()=>{const sample=exampleProfiles[exampleIndex];setForm({...sample});setExampleIndex(index=>(index+1)%exampleProfiles.length);setSaved(false);setMatchNotice('Example '+(exampleIndex+1)+' of '+exampleProfiles.length+' loaded. Click again to try the next one.');setError('');};
  const buildPatch=()=>({...form,name:form.name.trim(),skills:form.skills.split(',').map(skill=>skill.trim()).filter(Boolean).filter((skill,index,all)=>all.findIndex(value=>value.toLocaleLowerCase()===skill.toLocaleLowerCase())===index),location:form.location.trim(),headline:form.headline.trim(),overview:form.overview.trim(),education:form.education.trim(),experienceSummary:form.experienceSummary.trim(),resumeText:form.resumeText.trim(),targetJob:form.targetJob.trim(),additionalInfo:form.additionalInfo.trim()});
  const save=async event=>{event.preventDefault();if(!form.name.trim()){setError('Please enter your name.');return;}setSaving(true);setError('');try{const patch=buildPatch();await saveUserProfile(user.uid,patch);onSaved(patch);setSaved(true);}catch(err){setError(err.message||'Your profile could not be saved. Please try again.');}finally{setSaving(false);}};
  const matchJobs=async()=>{if(!form.name.trim()){setError('Add your name and save your profile before searching.');return;}if(!form.targetJob.trim()){setError('Add a target role before searching for matching jobs.');return;}if(!form.resumeText.trim()||form.resumeText.trim().length<40||form.resumeText.trim().split(/\s+/).length<8){setError('Add at least a few lines about your experience, education, or projects so roles can be matched to your profile.');return;}setMatching(true);setError('');setMatchNotice('');try{const patch=buildPatch();await saveUserProfile(user.uid,patch);onSaved(patch);const jobs=await searchRealJobsWithAI(patch.targetJob,patch.isFresher,patch);if(!Array.isArray(jobs)||jobs.length===0)throw new Error('No job listings were returned. Try another target role.');const jobsWithIds=jobs.map((job,index)=>({...job,id:job.id||'job-'+Date.now()+'-'+index}));await saveUserProfile(user.uid,{foundJobs:jobsWithIds,exampleRequirements:[]});onSaved({...patch,foundJobs:jobsWithIds,exampleRequirements:[]});setSaved(true);setMatchNotice('Found '+jobsWithIds.length+' matching roles. Your profile and matches are saved.');}catch(err){setError(err.message||'Could not find matching jobs. Please try again.');}finally{setMatching(false);}};
  const input='w-full bg-[#0B1020] border border-[#263554] rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-[#60A5FA]';const label='block text-sm font-medium text-slate-300 mb-2';
  return <div className="max-w-4xl mx-auto pb-10 animate-in fade-in duration-300"><header className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-[#60A5FA]">Your details, your choice</p><h1 className="text-4xl font-bold mt-2 text-white">My Profile</h1><p className="text-slate-400 mt-2">Save your profile whenever you like. Job matching is a separate step you control.</p></div><div className="flex gap-2"><button type="button" onClick={loadExample} className="text-sm text-cyan-200 hover:text-white px-4 py-2 rounded-lg border border-cyan-400/30">Load example ({exampleIndex+1}/{exampleProfiles.length})</button><button type="button" onClick={onComplete} className="text-sm text-slate-300 hover:text-white px-4 py-2 rounded-lg border border-[#263554]">Back to dashboard</button></div></header><form onSubmit={save} className="bg-[#121A2F] border border-[#192440] rounded-3xl p-6 md:p-8 space-y-7">{error&&<p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}<section><h2 className="text-lg font-semibold text-white mb-4">About you</h2><div className="grid md:grid-cols-2 gap-5"><label className={label}>Full name<input required value={form.name} onChange={e=>update('name',e.target.value)} className={input+' mt-2'} placeholder="Your name" autoComplete="name"/></label><label className={label}>Location<input value={form.location} onChange={e=>update('location',e.target.value)} className={input+' mt-2'} placeholder="City, country, or time zone"/></label><label className={label+' md:col-span-2'}>Professional headline<input value={form.headline} onChange={e=>update('headline',e.target.value)} className={input+' mt-2'} placeholder="Your role or specialty"/></label><label className={label+' md:col-span-2'}>Career overview<textarea rows={3} value={form.overview} onChange={e=>update('overview',e.target.value)} className={input+' mt-2 resize-y'} placeholder="A short introduction to your experience and goals"/></label></div></section><section><h2 className="text-lg font-semibold text-white mb-4">Experience and goals</h2><div className="grid md:grid-cols-2 gap-5"><label className={label}>Key skills<input value={form.skills} onChange={e=>update('skills',e.target.value)} className={input+' mt-2'} placeholder="Separate skills with commas"/></label><label className={label}>Education<input value={form.education} onChange={e=>update('education',e.target.value)} className={input+' mt-2'} placeholder="Degree, school, or current studies"/></label><label className={label+' md:col-span-2'}>Work, internships, or projects<textarea rows={3} value={form.experienceSummary} onChange={e=>update('experienceSummary',e.target.value)} className={input+' mt-2 resize-y'} placeholder="Relevant work, volunteering, internships, or projects"/></label><div className="relative"><label className={label} htmlFor="profile-target-role">Target role</label><input id="profile-target-role" role="combobox" aria-expanded={showRoleSuggestions&&matchingRoles.length>0} aria-controls="profile-role-suggestions" value={form.targetJob} onFocus={()=>setShowRoleSuggestions(true)} onBlur={()=>setTimeout(()=>setShowRoleSuggestions(false),120)} onChange={e=>{update('targetJob',e.target.value);setShowRoleSuggestions(true);}} onKeyDown={e=>{if(e.key==='Escape')setShowRoleSuggestions(false);if(e.key==='Enter'&&showRoleSuggestions&&matchingRoles.length){e.preventDefault();selectRole(matchingRoles[0]);}}} className={input} placeholder="Role you want to work toward"/>{showRoleSuggestions&&matchingRoles.length>0&&<div id="profile-role-suggestions" role="listbox" className="absolute z-30 top-full left-0 right-0 mt-2 rounded-xl border border-[#334155] bg-[#121A2F] shadow-xl overflow-hidden">{matchingRoles.map(role=><button key={role} type="button" role="option" onMouseDown={e=>e.preventDefault()} onClick={()=>selectRole(role)} className="block w-full text-left px-4 py-3 text-sm text-slate-200 hover:bg-[#1B2A45]">{role}</button>)}</div>}</div><label className={label}>Preferred work type<select value={form.preferredWorkType} onChange={e=>update('preferredWorkType',e.target.value)} className={input+' mt-2'}>{['Any','Full-time','Part-time','Contract','Internship'].map(type=><option key={type}>{type}</option>)}</select></label><label className={label+' md:col-span-2'}>Resume text<textarea rows={5} value={form.resumeText} onChange={e=>update('resumeText',e.target.value)} className={input+' mt-2 resize-y font-mono text-sm'} placeholder="Paste your resume details here"/></label><label className={label+' md:col-span-2'}>Anything else you'd like included<textarea rows={3} value={form.additionalInfo} onChange={e=>update('additionalInfo',e.target.value)} className={input+' mt-2 resize-y'} placeholder="Certifications, links, achievements, preferences, or other details"/></label><fieldset className="md:col-span-2"><legend className={label}>Career stage</legend><div className="flex flex-wrap gap-3"><button type="button" onClick={()=>update('isFresher',true)} className={'rounded-xl px-4 py-2 border '+(form.isFresher?'bg-blue-500/15 border-blue-400 text-blue-200':'border-[#263554] text-slate-400')}>Fresher / early career</button><button type="button" onClick={()=>update('isFresher',false)} className={'rounded-xl px-4 py-2 border '+(!form.isFresher?'bg-blue-500/15 border-blue-400 text-blue-200':'border-[#263554] text-slate-400')}>Experienced</button></div></fieldset></div></section><div className="border-t border-[#263554] pt-6"><div className="flex flex-wrap items-center gap-4"><button type="submit" disabled={saving||matching} className="rounded-xl bg-[#3B82F6] hover:bg-[#60A5FA] disabled:opacity-60 px-6 py-3 text-white font-semibold">{saving?'Saving…':'Save profile'}</button>{saved&&<p role="status" className="text-sm text-emerald-300 flex items-center gap-2"><CheckCircle size={16}/> Saved. This profile is now reflected on your dashboard.</p>}</div><div className="mt-7 rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-5"><h2 className="text-base font-semibold text-white">Ready to look for work?</h2><p className="text-sm text-slate-400 mt-1">This separate step searches job listings and compares their requirements with your resume, skills, experience, and career stage.</p><button type="button" onClick={matchJobs} disabled={saving||matching} className="mt-4 rounded-xl bg-cyan-300 hover:bg-cyan-200 disabled:opacity-60 px-5 py-3 text-slate-950 font-bold">{matching?'Searching and matching…':'Find and match jobs'}</button>{matchNotice&&<p role="status" className="mt-3 text-sm text-emerald-300">{matchNotice}</p>}</div></div></form></div>;
}

function NewsWidget({ targetJob }) {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const getNews = async () => {
      try {
        const data = await fetchIndustryNews(targetJob);
        setNews(data);
      } catch (e) {
        console.error("Failed to fetch news", e);
      } finally {
        setLoading(false);
      }
    };
    if (targetJob) getNews();
    else setLoading(false);
  }, [targetJob]);

  if (loading) return <div className="flex-1 flex justify-center items-center"><Loader2 className="animate-spin text-[#3B82F6]" /></div>;
  if (!news.length) return <div className="text-slate-500 text-sm">No recent news found.</div>;

  return (
    <div className="space-y-6 flex-1 overflow-y-auto pr-2 custom-scrollbar">
      {news.map((item, i) => (
        <a key={i} href={item.url} target="_blank" rel="noopener noreferrer" className="block group">
          <h4 className="text-white font-semibold text-sm leading-snug group-hover:text-[#3B82F6] transition-colors mb-2 line-clamp-2">{item.title}</h4>
          <p className="text-slate-400 text-xs line-clamp-3 leading-relaxed">{item.summary}</p>
        </a>
      ))}
    </div>
  );
}

function JobMarket({ user, userData, onNavigate }) {
  if (!userData.foundJobs || userData.foundJobs.length === 0) return <div className="text-slate-400">No jobs found. Go to Setup first.</div>;

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-12">
        <h1 className="text-4xl font-bold mb-2 text-white">Live Job Market</h1>
        <p className="text-slate-400 text-lg">Active roles found for: <span className="text-[#60A5FA] font-medium">{userData.targetJob}</span></p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {userData.foundJobs.map((job) => {
          const hasAnalysis = userData.analyses && userData.analyses[job.id];
          const mentorMatches = getRecommendedMentors(job.missing_skills || []);
          return (
            <div key={job.id} className="bg-[#121A2F] border border-[#192440] rounded-3xl p-8 flex flex-col justify-between hover:border-[#3B82F6]/50 transition-colors">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                  <h3 className="text-2xl font-bold text-white">{job.title}</h3>
                  {hasAnalysis && <span className="bg-[#3B82F6]/10 text-[#3B82F6] text-xs font-bold px-3 py-1.5 rounded-full border border-[#3B82F6]/20 uppercase tracking-wide">Analyzed</span>}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-sm text-slate-400 mb-6">
                  <span className="flex items-center gap-1.5 bg-[#0B1020] px-4 py-2 rounded-full border border-[#192440] font-medium"><Briefcase size={14} className="text-slate-300"/> {job.company}</span>
                  <span className="flex items-center gap-1.5 bg-[#0B1020] px-4 py-2 rounded-full border border-[#192440]"><Map size={14} className="text-slate-300"/> {job.location}</span>
                </div>
                <p className="text-sm text-slate-400 line-clamp-3 mb-5 bg-[#0B1020] p-5 rounded-2xl border border-[#192440] leading-relaxed">
                  {job.requirements_summary}
                </p>
                <div className="mb-6 rounded-2xl border border-[#192440] bg-[#0B1020] p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                    <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Profile match</span>
                    <span className="text-lg font-extrabold text-emerald-300">{Number.isFinite(Number(job.match_percentage)) ? `${Math.max(0, Math.min(100, Number(job.match_percentage)))}%` : '—'}</span>
                  </div>
                  {job.match_summary && <p className="text-sm text-slate-300 leading-relaxed mb-3">{job.match_summary}</p>}
                  {!!job.matched_skills?.length && <p className="text-xs text-emerald-200"><strong>Matching skills:</strong> {job.matched_skills.slice(0, 5).join(', ')}</p>}
                  {!!job.missing_skills?.length && <p className="text-xs text-amber-200 mt-2"><strong>Skills to build:</strong> {job.missing_skills.slice(0, 4).join(', ')}</p>}
                  {!!job.missing_skills?.length && <div className="mt-4 pt-4 border-t border-[#192440]"><p className="text-[11px] text-slate-500 uppercase tracking-wide mb-2">Top mentor matches</p><div className="flex flex-wrap gap-2">{mentorMatches.mentors.slice(0,2).map(mentor=><span key={mentor.name} className="inline-flex items-center gap-2 rounded-full bg-[#121A2F] border border-[#263554] py-1 pr-3 pl-1"><img src={mentor.img} alt="" className="w-6 h-6 rounded-full object-cover"/><span className="text-xs text-slate-200">{mentor.name}</span><span className="text-[11px] text-amber-300">★ {mentor.rating.toFixed(1)}</span></span>)}</div></div>}
                </div>
              </div>
              
              <div className="flex justify-between items-center mt-auto">
                <a href={job.url} target="_blank" rel="noopener noreferrer" className="text-sm text-slate-400 hover:text-white inline-flex items-center gap-1.5 transition-colors font-medium">
                  View original <ExternalLink size={14} />
                </a>
                <button 
                  onClick={() => onNavigate(`analysis-${job.id}`)}
                  className={`px-6 py-3 rounded-full font-bold transition-all text-sm ${
                    hasAnalysis ? 'bg-[#0B1020] text-white border border-[#192440] hover:border-[#3B82F6]' : 'bg-[#3B82F6] text-white hover:bg-[#60A5FA]'
                  }`}
                >
                  {hasAnalysis ? 'View Roadmap' : 'Analyze Fit'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SpecificAnalysis({ user, userData, jobId, onNavigate }) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const job = userData.foundJobs.find(j => j.id === jobId);
  const analysis = userData.analyses ? userData.analyses[jobId] : null;

  useEffect(() => {
    if (!analysis && job && userData.resumeText && !isAnalyzing) runAnalysis();
  }, [jobId]);

  const runAnalysis = async () => {
    setIsAnalyzing(true);
    setAnalysisError('');
    try {
      const result = await analyzeSpecificJobFit(userData.resumeText, job, userData.isFresher);
      const formattedTasks = result.roadmap_tasks.map(t => ({ ...t, id: t.id || crypto.randomUUID(), completed: false }));
      const newAnalysis = { ...result, roadmap_tasks: formattedTasks, timestamp: new Date().toISOString() };
      const updatedAnalyses = { ...(userData.analyses || {}), [jobId]: newAnalysis };
      await saveUserProfile(user.uid, { analyses: updatedAnalyses });
    } catch (err) { console.error(err); setAnalysisError(err.message || 'Could not generate this roadmap. Please try again.'); } finally { setIsAnalyzing(false); }
  };

  const toggleTask = async (taskId) => {
    if (!analysis) return;
    const updatedTasks = analysis.roadmap_tasks.map(t => t.id === taskId ? { ...t, completed: !t.completed } : t);
    const updatedAnalyses = { ...userData.analyses, [jobId]: { ...analysis, roadmap_tasks: updatedTasks } };
    await saveUserProfile(user.uid, { analyses: updatedAnalyses });
  };

  if (!job) return <div>Job not found.</div>;
  if (analysisError && !analysis) return <div className="max-w-xl mx-auto mt-16 text-center"><p className="text-rose-400 mb-5">{analysisError}</p><button onClick={runAnalysis} className="bg-[#3B82F6] text-white px-6 py-3 rounded-xl font-bold">Try again</button></div>;
  if (isAnalyzing || !analysis) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh]">
        <Loader2 className="w-16 h-16 text-[#3B82F6] animate-spin mb-8" />
        <h2 className="text-3xl font-bold mb-3 text-white">Generating {userData.isFresher ? 'Fresher' : ''} Roadmap...</h2>
        <p className="text-slate-400 max-w-md text-center">Analyzing gaps for <strong className="text-white">{job.title}</strong></p>
      </div>
    );
  }

  const completedTasks = analysis.roadmap_tasks.filter(t => t.completed);
  const pendingTasks = analysis.roadmap_tasks.filter(t => !t.completed);
  const mentorRecommendations = getRecommendedMentors(analysis.missing_skills || []);

  return (
    <div className="max-w-6xl mx-auto pb-20">
      <button onClick={() => onNavigate('market')} className="text-sm text-slate-400 hover:text-white mb-8 inline-flex items-center gap-1.5 transition-colors font-medium">
        <ChevronRight size={14} className="rotate-180" /> Back to Jobs
      </button>

      <div className="bg-[#121A2F] p-10 rounded-3xl border border-[#192440] mb-8 flex flex-col md:flex-row justify-between items-center gap-8">
        <div>
          <h1 className="text-3xl font-bold mb-4 text-white">{job.title}</h1>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="bg-[#0B1020] px-4 py-2 rounded-full border border-[#192440] text-slate-300">{job.company}</span>
            {userData.isFresher && <span className="bg-[#3B82F6]/10 text-[#60A5FA] px-4 py-2 rounded-full border border-[#3B82F6]/20">Fresher Analysis</span>}
          </div>
        </div>
        <div className="text-center bg-[#0B1020] p-8 rounded-3xl border border-[#192440] min-w-[200px]">
          <div className="text-xs text-slate-500 uppercase tracking-widest mb-2 font-bold">Match Score</div>
          <div className="text-6xl font-black text-white">{analysis.skill_match_percentage}%</div>
        </div>
      </div>

      <section className="mb-8 rounded-3xl border border-[#192440] bg-[#121A2F] p-7"><div className="mb-5"><p className="text-xs uppercase tracking-widest text-[#60A5FA] font-bold">Mentor matches</p><h2 className="text-2xl text-white font-bold mt-2">People who can help close your skill gaps</h2><p className="text-sm text-slate-400 mt-2">{mentorRecommendations.hasSkillMatches?'Matched by missing skills, then ranked by rating.':'No exact skill match found; these are the highest-rated mentors.'}</p></div><div className="grid md:grid-cols-3 gap-4">{mentorRecommendations.mentors.map(mentor=><article key={mentor.name} className="rounded-2xl border border-[#263554] bg-[#0B1020] p-5"><div className="flex items-center gap-3"><img src={mentor.img} alt={mentor.name} className="w-12 h-12 rounded-xl object-cover"/><div><h3 className="font-bold text-white">{mentor.name}</h3><p className="text-xs text-amber-300">★ {mentor.rating.toFixed(1)} · {mentor.reviewCount} reviews</p></div></div><p className="text-xs text-slate-400 mt-3">{mentor.role}</p><div className="flex flex-wrap gap-1.5 mt-3">{(mentor.matchedGapSkills.length?mentor.matchedGapSkills:mentor.skills.slice(0,2)).map(skill=><span key={skill} className="text-[11px] rounded-full bg-[#17233A] text-slate-200 px-2.5 py-1">{skill}</span>)}</div><p className="text-xs text-slate-400 mt-3 line-clamp-2">“{mentor.review}”</p></article>)}</div><p className="text-[11px] text-slate-600 mt-4">Mentors, ratings, and reviews are sample preview content.</p></section>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="space-y-8 lg:col-span-1">
          <div className="bg-[#121A2F] p-8 rounded-3xl border border-[#192440]">
            <h3 className="text-xs font-bold mb-5 text-emerald-400 uppercase tracking-widest flex items-center gap-2"><CheckCircle size={16} /> Verified Skills</h3>
            <div className="flex flex-wrap gap-2">
              {analysis.matched_skills.map((skill, i) => (
                <span key={i} className="bg-[#0B1020] border border-[#192440] text-slate-300 px-3 py-1.5 rounded-lg text-sm">{skill}</span>
              ))}
            </div>
          </div>
          <div className="bg-[#121A2F] p-8 rounded-3xl border border-[#192440]">
            <h3 className="text-xs font-bold mb-5 text-rose-400 uppercase tracking-widest flex items-center gap-2"><Zap size={16} /> Missing Skills</h3>
            <div className="flex flex-wrap gap-2">
              {analysis.missing_skills.map((skill, i) => (
                <span key={i} className="bg-[#0B1020] border border-rose-500/20 text-white px-3 py-1.5 rounded-lg text-sm">{skill}</span>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 bg-[#121A2F] p-10 rounded-3xl border border-[#192440]">
          <h2 className="text-2xl font-bold mb-8 flex items-center gap-3 text-white">Execution Plan</h2>
          <div className="space-y-4">
            {pendingTasks.map((task) => (
              <div key={task.id} className="bg-[#0B1020] p-6 rounded-2xl border border-[#192440] hover:border-[#3B82F6]/50 transition-all flex gap-5 items-start">
                <button onClick={() => toggleTask(task.id)} className="mt-1 flex-shrink-0 text-slate-600 hover:text-[#3B82F6] transition-colors"><Circle size={26} /></button>
                <div>
                  <h3 className="font-bold text-lg mb-2 text-white flex items-center gap-3">
                    {task.skill} 
                    <span className="text-xs font-medium bg-[#121A2F] text-slate-400 px-2.5 py-1 rounded-md border border-[#192440]">{task.estimated_duration}</span>
                  </h3>
                  <p className="text-slate-400 text-sm leading-relaxed">{task.description}</p>
                </div>
              </div>
            ))}
          </div>

          {completedTasks.length > 0 && (
            <div className="mt-10 pt-8 border-t border-[#192440] space-y-4 opacity-70">
              <h2 className="text-xs font-bold mb-5 text-slate-500 uppercase tracking-widest flex items-center gap-2"><CheckCircle size={16} /> Completed</h2>
              {completedTasks.map((task) => (
                <div key={task.id} className="bg-[#0B1020] p-5 rounded-2xl border border-[#192440] flex gap-4 items-center">
                  <button onClick={() => toggleTask(task.id)} className="flex-shrink-0 text-emerald-400"><CheckCircle size={22} /></button>
                  <div className="flex-1 line-through text-slate-500 font-medium">{task.skill}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AIChatbot({ userData }) {
  const [isOpen, setIsOpen] = useState(false);
  const firstName = userData.name?.trim().split(/\s+/)[0];
  const greeting = firstName ? `Hi ${firstName}! Need help with your career roadmap or interview prep?` : "Hi! Need help with your career roadmap or interview prep?";
  const [messages, setMessages] = useState([{ role: 'model', content: greeting }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    setMessages(current => current.length === 1 && current[0].role === 'model' ? [{ ...current[0], content: greeting }] : current);
  }, [greeting]);

  useEffect(() => { if (isOpen) chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isOpen]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    
    const userMsg = input.trim();
    const newMessages = [...messages, { role: 'user', content: userMsg }];
    setMessages([...newMessages, { role: 'model', content: '' }]);
    setInput('');
    setLoading(true);

    try {
      await chatWithAI(userMsg, newMessages, {
        name: userData.name, targetJob: userData.targetJob, isFresher: userData.isFresher,
        skills: userData.skills, location: userData.location, score: 75
      }, responseText => setMessages([...newMessages, { role: 'model', content: responseText }]));
    } catch (err) {
      setMessages([...newMessages, { role: 'model', content: err.message || "Sorry, I'm having trouble connecting right now. Please try again in a moment." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button 
        onClick={() => setIsOpen(true)}
        className={`fixed bottom-8 right-8 bg-[#3B82F6] hover:bg-[#60A5FA] text-white p-4 rounded-full shadow-2xl transition-transform z-50 ${isOpen ? 'scale-0' : 'scale-100'}`}
      >
        <MessageSquare size={24} />
      </button>

      {isOpen && (
        <div className="fixed bottom-8 right-8 w-80 md:w-96 bg-[#121A2F] border border-[#192440] rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden animate-in slide-in-from-bottom-5">
          <div className="bg-[#0B1020] p-4 flex justify-between items-center border-b border-[#192440]">
            <div className="flex items-center gap-2 font-bold text-white"><BrainCircuit size={18} className="text-[#3B82F6]" /> Career Coach AI</div>
            <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-white"><X size={18}/></button>
          </div>
          
          <div className="p-4 h-80 overflow-y-auto bg-[#0B1020] flex flex-col gap-4 text-sm custom-scrollbar">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`p-3 rounded-2xl max-w-[85%] leading-relaxed ${msg.role === 'user' ? 'bg-[#3B82F6] text-white rounded-tr-sm' : 'bg-[#121A2F] border border-[#192440] text-slate-200 rounded-tl-sm'}`}>
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && !messages[messages.length - 1]?.content && <div className="text-slate-500 text-xs flex items-center gap-2"><Loader2 size={12} className="animate-spin"/> AI is preparing a reply...</div>}
            <div ref={chatEndRef} />
          </div>

          <form onSubmit={handleSend} className="p-3 bg-[#121A2F] border-t border-[#192440] flex gap-2">
            <input 
              type="text" 
              value={input} 
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your roadmap..."
              className="flex-1 bg-[#0B1020] border border-[#192440] rounded-full px-4 py-2 text-sm text-white focus:outline-none focus:border-[#3B82F6]"
            />
            <button type="submit" disabled={!input.trim() || loading} className="bg-[#3B82F6] text-white p-2 rounded-full disabled:opacity-50 hover:bg-[#60A5FA] transition-colors">
              <Send size={16} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
