import { BRAND } from "@/lib/brand";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  path: "/privacidade",
  title: "Privacidade",
  description:
    "Política de privacidade do Ponto Cego: sem contas, sem anúncios, sem rastreadores de terceiros — e o que medimos em primeira mão.",
});

/**
 * Privacy page (spec §7, LGPD). The honest version is short because the
 * data practice is short: no accounts, no ads, no trackers, one anonymous
 * cookie for votes, and a reading profile that never leaves the browser.
 */
export default function PrivacidadePage() {
  return (
    <main className="pc-prose">
        <h1>Privacidade</h1>
        <p>
          O {BRAND.name} funciona sem conta, não veicula anúncios e não usa
          rastreadores de terceiros. Esta página descreve tudo o que é coletado,
          nos termos da LGPD (Lei 13.709/2018).
        </p>

        <h2>O que coletamos</h2>
        <ul>
          <li>
            <strong>Voto de concordância</strong> (Concordo/Discordo em um artigo):
            guardamos o artigo, a direção do voto, a data e um identificador de
            sessão anônimo — um cookie aleatório que não contém e não se liga a
            nome, e-mail ou endereço IP. Ele existe para impedir votos duplicados
            e limitar abuso.
          </li>
          <li>
            <strong>Medição de audiência em primeira mão</strong>: contamos, nos
            nossos próprios servidores, páginas vistas, cliques de “Continuar
            para o veículo”, termos buscados e de onde veio a visita (domínio de
            origem). Esses eventos usam o mesmo cookie de sessão anônimo dos
            votos — sem IP, sem impressão digital do navegador, sem nome — e
            nada disso é enviado a terceiros. Os eventos brutos são apagados em
            90 dias; além disso guardamos apenas contagens diárias agregadas.
          </li>
          <li>
            <strong>Preferência de tema</strong> (claro/escuro): um cookie
            funcional que guarda apenas essa escolha — nenhum identificador,
            nenhuma medição. Serve só para o site abrir no tema que você
            escolheu.
          </li>
          <li>
            <strong>Registros operacionais</strong> de curta duração (logs de
            servidor) para manter o serviço no ar.
          </li>
        </ul>

        <h2>O que NÃO coletamos</h2>
        <ul>
          <li>
            <strong>Seu histórico de leitura.</strong> O “Meu Perfil de Viés” é
            calculado e armazenado exclusivamente no seu navegador
            (localStorage), é opcional, e o botão “Apagar dados e desativar”
            remove tudo na hora. Nada dele é enviado ao servidor.
          </li>
          <li>Não há cadastro, e-mail, telefone ou dado de pagamento nesta fase.</li>
          <li>
            Não usamos pixels, analytics de terceiros ou publicidade. A medição
            descrita acima roda inteiramente nos nossos servidores — nenhum
            Google Analytics, nenhuma empresa de ad tech.
          </li>
        </ul>

        <h2>Base legal e retenção</h2>
        <p>
          Votos anônimos, medição de audiência e logs operacionais são tratados
          sob legítimo interesse (manter a integridade dos rótulos e do
          serviço). Identificadores de sessão não são associados a identidade
          civil em nenhum momento. Eventos de medição brutos expiram em 90
          dias; só agregados diários (números, nunca sessões) são mantidos.
        </p>

        <h2 id="newsletter">Newsletter</h2>
        <p>
          Se você assinar o boletim diário, guardamos o seu e-mail, a data da
          inscrição, a data da confirmação e um código aleatório usado nos
          links de confirmação e de saída. Nada é enviado antes de você clicar
          no link de confirmação. A entrega é feita pela Resend (resend.com),
          que processa o endereço apenas para enviar. Cada edição traz um link
          de saída de um clique; ao sair, o endereço fica marcado como
          cancelado e não recebe mais nada. Para apagar o registro por
          completo, escreva para contato@pontocego.app.
        </p>

        <h2>Seus direitos</h2>
        <p>
          Para qualquer pedido — inclusive exclusão dos votos de uma sessão —
          escreva para{" "}
          <a href={`mailto:${BRAND.contactEmail}`}>{BRAND.contactEmail}</a>. Pedidos
          são atendidos e registrados com prazo de resposta.
        </p>
    </main>
  );
}
