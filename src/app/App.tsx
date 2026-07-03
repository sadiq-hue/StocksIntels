import { RouterProvider } from "react-router";
import { router } from "./routes";
import { BusinessProvider } from "../lib/business-context";

export default function App() {
  return (
    <BusinessProvider>
      <RouterProvider router={router} />
    </BusinessProvider>
  );
}