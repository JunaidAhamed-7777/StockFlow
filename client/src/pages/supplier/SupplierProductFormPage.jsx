import { useLocation, useParams } from "react-router-dom";
import { ProductForm } from "../../components/ProductForm";
import { productListReturnTo } from "../../utils/productReturnTo.mjs";

export function SupplierProductFormPage() {
  const { id } = useParams();
  const location = useLocation();
  const returnTo = productListReturnTo(location.state?.returnTo, "/supplier/products");
  return <ProductForm productId={id} cancelTo={returnTo} successTo={returnTo} />;
}
