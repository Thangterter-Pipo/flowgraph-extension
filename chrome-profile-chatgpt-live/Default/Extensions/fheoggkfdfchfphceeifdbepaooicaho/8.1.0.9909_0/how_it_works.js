/*!
 * 
 *     MCAFEE RESTRICTED CONFIDENTIAL
 *     Copyright (c) 2026 McAfee, LLC
 *
 *     The source code contained or described herein and all documents related
 *     to the source code ("Material") are owned by McAfee or its
 *     suppliers or licensors. Title to the Material remains with McAfee
 *     or its suppliers and licensors. The Material contains trade
 *     secrets and proprietary and confidential information of McAfee or its
 *     suppliers and licensors. The Material is protected by worldwide copyright
 *     and trade secret laws and treaty provisions. No part of the Material may
 *     be used, copied, reproduced, modified, published, uploaded, posted,
 *     transmitted, distributed, or disclosed in any way without McAfee's prior
 *     express written permission.
 *
 *     No license under any patent, copyright, trade secret or other intellectual
 *     property right is granted to or conferred upon you by disclosure or
 *     delivery of the Materials, either expressly, by implication, inducement,
 *     estoppel or otherwise. Any license under such intellectual property rights
 *     must be expressed and approved by McAfee in writing.
 *
 */(()=>{"use strict";var e,t={5055:(e,t,l)=>{const r=chrome;class o{static geti18nRes(e,t=[]){let l=r.i18n.getMessage(e,t);const o=r.i18n.getMessage("res_PRODUCT_NAME_TRADEMARKED");return l=l.replace(/%PRODUCTNAME%/g,o),l}static getResStr(e,t){const l=o.geti18nRes(e);t("??"===l?"":l)}static async getFileSource(e){try{return(await fetch(r.runtime.getURL(e))).text()}catch(e){return""}}}class s{constructor(e=null,t=document){if(this.resourcerequestor=o,this.document=t,e){const t=this.document.querySelectorAll(`#${e}`);t&&(this.document=t[0].contentDocument)}this.localeData=this.localeData.bind(this),this.fillText=this.fillText.bind(this),this.fillLocalizedTexts=this.fillLocalizedTexts.bind(this),this.fillInputPlaceHolders=this.fillInputPlaceHolders.bind(this)}localeData(e,t=[]){return this.resourcerequestor.geti18nRes(e,t)}fillText(e,t){const l=this.document.getElementById(e);if(l){const e=l.getAttribute("x-mcinsertposition");if(e)return void l.insertAdjacentText(e,t);l.textContent=t,l.setAttribute("x-mcl10nprocessed",!0)}}fillLocalizedTexts(){for(const{id:e}of this.document.querySelectorAll("*[x-mclocalizedtext]:not([x-mcl10nprocessed=true])")){const t=this.localeData(e);if(null==t)return!1;this.fillText(e,t)}return!0}fillInputPlaceHolders(){for(const{id:e}of this.document.querySelectorAll("*[x-inputplaceholder]")){const t=this.localeData(e),l=this.document.getElementById(e);if(null==t)return!1;null!=l&&l.setAttribute("placeholder",t)}return!0}init(){this.fillLocalizedTexts(),this.fillInputPlaceHolders()}}var i=l(194),n=l(4924);const{NONE:a,...c}=i.D,u=(n.AK,Symbol.iterator,2026);r.runtime.getURL("");var h=l(4692);class f{static init(){const e=new s;e.init(),h("#howitworks_refund_trademark").text(e.localeData("howitworks_refund_trademark",[u]));const t=`<a href='https://www.mcafee.com/consumer/en-us/policy/global/legal.html'>${e.localeData("howitworks_legal_license")}</a>`,l=`<a href='https://www.mcafee.com/consumer/en-us/policy/global/legal.html'>${e.localeData("howitworks_legal_notice")}</a>`,r=`<a href='https://www.mcafee.com/en-us/consumer-support/help/system-requirement.html'>${e.localeData("howitworks_legal_req")}</a>`,o=e.localeData("howitworks_legal",[t,l,r]);h("#howitworks_legal").append(o)}}h((()=>f.init()))}},l={};function r(e){var o=l[e];if(void 0!==o)return o.exports;var s=l[e]={exports:{}};return t[e].call(s.exports,s,s.exports,r),s.exports}r.m=t,e=[],r.O=(t,l,o,s)=>{if(!l){var i=1/0;for(u=0;u<e.length;u++){for(var[l,o,s]=e[u],n=!0,a=0;a<l.length;a++)(!1&s||i>=s)&&Object.keys(r.O).every((e=>r.O[e](l[a])))?l.splice(a--,1):(n=!1,s<i&&(i=s));if(n){e.splice(u--,1);var c=o();void 0!==c&&(t=c)}}return t}s=s||0;for(var u=e.length;u>0&&e[u-1][2]>s;u--)e[u]=e[u-1];e[u]=[l,o,s]},r.d=(e,t)=>{for(var l in t)r.o(t,l)&&!r.o(e,l)&&Object.defineProperty(e,l,{enumerable:!0,get:t[l]})},r.o=(e,t)=>Object.prototype.hasOwnProperty.call(e,t),r.j=9098,(()=>{var e={9098:0};r.O.j=t=>0===e[t];var t=(t,l)=>{var o,s,[i,n,a]=l,c=0;if(i.some((t=>0!==e[t]))){for(o in n)r.o(n,o)&&(r.m[o]=n[o]);if(a)var u=a(r)}for(t&&t(l);c<i.length;c++)s=i[c],r.o(e,s)&&e[s]&&e[s][0](),e[s]=0;return r.O(u)},l=self.webpackChunkwabrowserextensions=self.webpackChunkwabrowserextensions||[];l.forEach(t.bind(null,0)),l.push=t.bind(null,l.push.bind(l))})();var o=r.O(void 0,[8096,6659],(()=>r(5055)));o=r.O(o)})();
//# sourceMappingURL=sourceMap/chrome/how_it_works.js.map