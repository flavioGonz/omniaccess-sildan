import { redirect } from "next/navigation";
import { getEnabledModules } from "@/app/actions/modules";

export default async function AdminPage() {
    const modules = await getEnabledModules();
    
    if (modules.MODULE_QUEUE) {
        redirect("/admin/monitor-queue");
    } else if (modules.MODULE_FACE) {
        redirect("/admin/monitor-face");
    } else {
        redirect("/admin/monitor-lpr");
    }
}
