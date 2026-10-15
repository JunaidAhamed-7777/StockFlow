import { ProductForm } from "../../components/ProductForm";
import { useLocation, useParams } from "react-router-dom";
import { productListReturnTo } from "../../utils/productReturnTo.mjs";

export function AdminProductFormPage() {
  const { id } = useParams();
  const location = useLocation();
  const returnTo = productListReturnTo(location.state?.returnTo, "/admin/products");
  return <ProductForm productId={id} cancelTo={returnTo} successTo={returnTo} />;
}
