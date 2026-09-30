// The same bounded spatial map is shared by the body and each glyph vertex.
// It is a visual deformation, not a physical fluid simulation.
export const MAX_BODY_DISPLACEMENT = .18;
export const BODY_MOTION_GLSL = `
  uniform float bodyTime, bodyMotion;
  vec3 bodyWarp(vec3 v) {
    if(bodyMotion<=0.) return v;
    float t=bodyTime;
    return v+bodyMotion*vec3(
      .10*sin(v.y*1.3+t*.31)+.045*sin(v.z*2.-t*.17),
      .055*sin(v.x*1.2+v.z*1.7+t*.23),
      .09*sin(v.y*1.5-v.x*.9-t*.19));
  }
  vec3 bodyNormal(vec3 v,vec3 normal) {
    if(bodyMotion<=0.) return normal;
    vec3 tangent=normalize(cross(normal,abs(normal.y)<.9?vec3(0.,1.,0.):vec3(1.,0.,0.)));
    vec3 bitangent=cross(normal,tangent);
    vec3 p0=bodyWarp(v);
    return normalize(cross(bodyWarp(v+tangent*.003)-p0,bodyWarp(v+bitangent*.003)-p0));
  }
`;
