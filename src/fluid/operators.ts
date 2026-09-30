// Periodic MAC-grid reference operators. u[i,j] is the right face of cell i,j,
// v[i,j] its upper face. These deliberately match the GPU difference stencils.
export function divergence(velocity:Float32Array,size:number) {
  const result=new Float32Array(size*size);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=y*size+x,left=y*size+(x+size-1)%size,down=((y+size-1)%size)*size+x;
    result[i]=(velocity[i*4]-velocity[left*4]+velocity[i*4+1]-velocity[down*4+1])*size;
  }
  return result;
}
export function rms(values:ArrayLike<number>) {let sum=0;for(let i=0;i<values.length;i++)sum+=values[i]*values[i];return Math.sqrt(sum/values.length);}
export function projectReference(velocity:Float32Array,size:number,iterations:number) {
  const div=divergence(velocity,size);let p=new Float32Array(size*size),next=new Float32Array(size*size);
  for(let step=0;step<iterations;step++){
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const i=y*size+x;
      next[i]=(p[y*size+(x+size-1)%size]+p[y*size+(x+1)%size]+p[((y+size-1)%size)*size+x]+p[((y+1)%size)*size+x]-div[i]/(size*size))*.25;
    }
    [p,next]=[next,p];
  }
  const projected=new Float32Array(velocity);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=y*size+x;
    projected[i*4]-=(p[y*size+(x+1)%size]-p[i])*size;
    projected[i*4+1]-=(p[((y+1)%size)*size+x]-p[i])*size;
  }
  return {velocity:projected,pressure:p};
}
