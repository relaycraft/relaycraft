import type { ImgHTMLAttributes } from "react";
import chromeLogo from "../../assets/brands/chrome.svg";
import edgeLogo from "../../assets/brands/edge.svg";
import firefoxLogo from "../../assets/brands/firefox.svg";
import safariLogo from "../../assets/brands/safari.svg";
import { cn } from "../../lib/utils";

type BrandIconProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt">;

/** Official / curated brand marks (assets under src/assets/brands). */
function BrandImg({ src, className, ...props }: BrandIconProps & { src: string }) {
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      className={cn("object-contain select-none", className)}
      {...props}
    />
  );
}

export function ChromeBrandIcon(props: BrandIconProps) {
  return <BrandImg src={chromeLogo} {...props} />;
}

export function SafariBrandIcon(props: BrandIconProps) {
  return <BrandImg src={safariLogo} {...props} />;
}

export function FirefoxBrandIcon(props: BrandIconProps) {
  return <BrandImg src={firefoxLogo} {...props} />;
}

export function EdgeBrandIcon(props: BrandIconProps) {
  return <BrandImg src={edgeLogo} {...props} />;
}
