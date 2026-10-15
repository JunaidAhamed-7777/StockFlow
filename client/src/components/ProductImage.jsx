import { useEffect, useState } from "react";
import images from "../data/product-images.json";
import { Icon } from "./ui/Icon";

export function ProductImage({ product, className = "", showCredit = false }) {
  const photo = images[product?.sku];
  const [failed, setFailed] = useState(false);

  useEffect(() => { setFailed(false); }, [photo?.src]);

  return (
    <figure className={`relative bg-slate-100 overflow-hidden ${className}`}>
      {photo && !failed ? (
        <img src={photo.src} alt={photo.alt || `Illustrative photograph for ${product.name}`} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full flex flex-col items-center justify-center gap-2 text-slate-500" role="img" aria-label={`No photograph available for ${product?.name || "this product"}`}>
          <Icon name="inventory_2" size={36} />
          <span className="text-xs">Product photograph unavailable</span>
        </div>
      )}
      {photo && !failed ? <figcaption className="absolute bottom-0 inset-x-0 bg-slate-900/80 px-3 py-1 text-[11px] text-white">
        Illustrative photo{showCredit ? <> · <a href={photo.creditUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{photo.creditName}</a></> : null}
      </figcaption> : null}
    </figure>
  );
}
