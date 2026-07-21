import { createRouter, createWebHashHistory } from "vue-router";

import AppOptions from "./AppOptions.vue";
import AppProviderTypes from "./AppProviderTypes.vue";
import Privacy from "./Privacy.vue";
import AppCustomDict from "./AppCustomDict.vue";

const routes = [
    { path: "/", component: AppOptions },
    { path: "/provider-types", component: AppProviderTypes },
    { path: "/privacy", component: Privacy },
    { path: "/custom-dict", component: AppCustomDict },
]

const router = createRouter({
    history: createWebHashHistory(),
    routes
})

export default router
