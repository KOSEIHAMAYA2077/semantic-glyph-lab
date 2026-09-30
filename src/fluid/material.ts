import * as THREE from 'three';
import type {LetterField} from '../letters';
export function fluidMaterial(field:LetterField,displacement:THREE.Texture){
  return new THREE.ShaderMaterial({side:THREE.DoubleSide,depthWrite:true,uniforms:{glyphs:{value:field.texture},grid:{value:field.grid},density:{value:15},displacement:{value:displacement},domain:{value:3.6}},
    vertexShader:`varying vec3 p,n,viewN;void main(){p=position;n=normal;viewN=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`uniform sampler2D glyphs,displacement;uniform float grid,density,domain;varying vec3 p,n,viewN;
    vec3 pattern(vec2 plane,vec2 offset){vec2 d=texture2D(displacement,plane/domain+.5+offset).xy;return texture2D(glyphs,(plane+d*domain)*density/grid).rgb;}
    void main(){vec3 weights=pow(abs(normalize(n)),vec3(8.));weights/=max(.0001,weights.x+weights.y+weights.z);vec3 a=pattern(p.zy*vec2(sign(n.x),1.),vec2(0.));vec3 b=pattern(p.xz*vec2(1.,sign(n.y)),vec2(.37,.19));vec3 c=pattern(p.xy*vec2(sign(n.z),1.),vec2(.13,.63));float light=.36+.64*pow(abs(normalize(viewN).z),.55);gl_FragColor=vec4((a*weights.x+b*weights.y+c*weights.z)*light,1.);}`});
}
